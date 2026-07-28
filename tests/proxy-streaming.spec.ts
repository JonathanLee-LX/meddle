import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type AddressInfo, type IncomingHttpHeaders, type Server } from 'node:http'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const STREAM_DELAY_MS = 250
const repoRoot = resolve(process.cwd())

interface StreamState {
    ended: boolean
}

interface HttpProxyRequestResult {
    firstChunk: Promise<{ beforeUpstreamEnd: boolean }>
    complete: Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }>
}

interface RawProxyResponse {
    statusCode: number
    headers: Record<string, string>
    body: string
}

let upstream: Server
let upstreamPort = 0
let proxyProcess: ChildProcessWithoutNullStreams
let proxyPort = 0
let meddleHome = ''
const streamStates = new Map<string, StreamState>()

function listen(server: Server): Promise<number> {
    return new Promise((resolvePromise, reject) => {
        const onError = (error: Error) => reject(error)
        server.once('error', onError)
        server.listen(0, '127.0.0.1', () => {
            server.off('error', onError)
            resolvePromise((server.address() as AddressInfo).port)
        })
    })
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolvePromise) => {
        if (!server.listening) {
            resolvePromise()
            return
        }
        server.close(() => resolvePromise())
    })
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), milliseconds)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

async function reservePort(): Promise<number> {
    const server = createServer()
    const port = await listen(server)
    await closeServer(server)
    return port
}

async function waitForPort(port: number, child: ChildProcessWithoutNullStreams, output: string[]): Promise<void> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`代理进程提前退出: ${output.join('')}`)
        }

        const connected = await new Promise<boolean>((resolvePromise) => {
            const socket = netConnect({ host: '127.0.0.1', port })
            const finish = (value: boolean) => {
                socket.destroy()
                resolvePromise(value)
            }
            socket.once('connect', () => finish(true))
            socket.once('error', () => finish(false))
        })
        if (connected) return
        await delay(50)
    }

    throw new Error(`等待代理端口 ${port} 启动超时: ${output.join('')}`)
}

function startHttpProxyRequest(targetUrl: string, state: StreamState): HttpProxyRequestResult {
    let resolveFirst: ((value: { beforeUpstreamEnd: boolean }) => void) | undefined
    let rejectFirst: ((error: Error) => void) | undefined
    let resolveComplete: ((value: { statusCode: number; headers: IncomingHttpHeaders; body: string }) => void) | undefined
    let rejectComplete: ((error: Error) => void) | undefined
    let firstChunkSeen = false

    const firstChunk = new Promise<{ beforeUpstreamEnd: boolean }>((resolvePromise, rejectPromise) => {
        resolveFirst = resolvePromise
        rejectFirst = rejectPromise
    })
    const complete = new Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }>((resolvePromise, rejectPromise) => {
        resolveComplete = resolvePromise
        rejectComplete = rejectPromise
    })

    const request = httpRequest({
        host: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method: 'GET',
        headers: {
            Host: '127.0.0.1:' + upstreamPort,
            Connection: 'close',
        },
    }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
            if (!firstChunkSeen) {
                firstChunkSeen = true
                resolveFirst?.({ beforeUpstreamEnd: !state.ended })
            }
            chunks.push(Buffer.from(chunk))
        })
        response.on('end', () => {
            resolveComplete?.({
                statusCode: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            })
        })
        response.on('error', (error) => {
            rejectFirst?.(error)
            rejectComplete?.(error)
        })
    })
    request.on('error', (error) => {
        rejectFirst?.(error)
        rejectComplete?.(error)
    })
    request.end()

    return { firstChunk, complete }
}

async function connectThroughMitm(): Promise<TLSSocket> {
    const socket = netConnect({ host: '127.0.0.1', port: proxyPort })
    await once(socket, 'connect')
    socket.write(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\nConnection: keep-alive\r\n\r\n`)

    let response = Buffer.alloc(0)
    while (!response.includes('\r\n\r\n')) {
        const [chunk] = await once(socket, 'data') as [Buffer]
        response = Buffer.concat([response, Buffer.from(chunk)])
    }
    expect(response.toString('latin1')).toMatch(/^HTTP\/1\.1 200 /)

    const secureSocket = tlsConnect({
        socket,
        rejectUnauthorized: false,
    })
    await once(secureSocket, 'secureConnect')
    return secureSocket
}

function startRawHttpRequest(socket: TLSSocket, path: string): Promise<{ firstChunk: Promise<{ beforeUpstreamEnd: boolean }>; complete: Promise<RawProxyResponse> }> {
    const state = streamStates.get(path)
    if (!state) throw new Error(`缺少流状态: ${path}`)

    let resolveFirst: ((value: { beforeUpstreamEnd: boolean }) => void) | undefined
    let rejectFirst: ((error: Error) => void) | undefined
    let resolveComplete: ((value: RawProxyResponse) => void) | undefined
    let rejectComplete: ((error: Error) => void) | undefined
    let firstChunkSeen = false
    let headerBuffer = Buffer.alloc(0)
    let headersParsed = false
    let statusCode = 0
    let headers: Record<string, string> = {}
    let expectedLength: number | null = null
    const bodyChunks: Buffer[] = []

    const firstChunk = new Promise<{ beforeUpstreamEnd: boolean }>((resolvePromise, rejectPromise) => {
        resolveFirst = resolvePromise
        rejectFirst = rejectPromise
    })
    const complete = new Promise<RawProxyResponse>((resolvePromise, rejectPromise) => {
        resolveComplete = resolvePromise
        rejectComplete = rejectPromise
    })

    const finish = () => {
        const body = Buffer.concat(bodyChunks)
        if (expectedLength !== null && body.length < expectedLength) return
        resolveComplete?.({ statusCode, headers, body: body.subarray(0, expectedLength ?? body.length).toString('utf8') })
        socket.destroy()
    }

    const consumeBody = (chunk: Buffer) => {
        if (!chunk.length) return
        if (!firstChunkSeen) {
            firstChunkSeen = true
            resolveFirst?.({ beforeUpstreamEnd: !state.ended })
        }
        bodyChunks.push(chunk)
        finish()
    }

    socket.on('data', (chunk: Buffer) => {
        if (!headersParsed) {
            headerBuffer = Buffer.concat([headerBuffer, Buffer.from(chunk)])
            const headerEnd = headerBuffer.indexOf('\r\n\r\n')
            if (headerEnd < 0) return
            const headerText = headerBuffer.subarray(0, headerEnd).toString('latin1')
            const lines = headerText.split('\r\n')
            statusCode = Number(lines.shift()?.split(' ')[1] || 0)
            headers = Object.fromEntries(lines.map((line) => {
                const separator = line.indexOf(':')
                return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()]
            }))
            expectedLength = headers['content-length'] ? Number(headers['content-length']) : null
            headersParsed = true
            consumeBody(headerBuffer.subarray(headerEnd + 4))
            headerBuffer = Buffer.alloc(0)
            return
        }
        consumeBody(Buffer.from(chunk))
    })
    socket.on('end', () => finish())
    socket.on('error', (error) => {
        rejectFirst?.(error)
        rejectComplete?.(error)
    })

    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\nConnection: close\r\n\r\n`)
    return { firstChunk, complete }
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
}

describe('proxy streaming responses', () => {
    beforeAll(async () => {
        upstream = createServer((request, response) => {
            const path = new URL(request.url || '/', `http://${request.headers.host}`).pathname
            if (path === '/json') {
                const body = '{"original":true}'
                response.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(body)),
                })
                response.end(body)
                return
            }

            const first = 'data: first\n\n'
            const second = 'data: second\n\n'
            const third = 'data: done\n\n'
            const state = streamStates.get(path) || { ended: false }
            state.ended = false
            streamStates.set(path, state)
            const body = first + second + third
            response.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Content-Length': String(Buffer.byteLength(body)),
                'Cache-Control': 'no-cache',
                'X-Stream-Test': 'true',
            })
            response.write(first)
            const timer = setTimeout(() => {
                response.write(second)
                response.end(third, () => { state.ended = true })
            }, STREAM_DELAY_MS)
            response.on('close', () => clearTimeout(timer))
        })
        upstreamPort = await listen(upstream)
        streamStates.set('/stream-http', { ended: false })
        streamStates.set('/stream-https', { ended: false })

        meddleHome = await mkdtemp(join(tmpdir(), 'meddle-streaming-'))
        await mkdir(join(meddleHome, 'plugins'), { recursive: true })
        await mkdir(join(meddleHome, 'route-rules'), { recursive: true })
        await writeFile(join(meddleHome, 'plugins', 'response-mutator.js'), `
module.exports = {
  manifest: {
    id: 'local.response-mutator',
    version: '1.0.0',
    apiVersion: '1.x',
    permissions: ['proxy:read'],
    hooks: ['onBeforeResponse']
  },
  setup() {},
  onBeforeResponse(context) {
    context.response.headers['x-plugin-mutated'] = 'true'
    context.response.body += '|plugin-mutated'
  }
}
`, 'utf8')
        await writeFile(join(meddleHome, 'route-rules', 'https-mitm.txt'),
            `^https://127\\.0\\.0\\.1:${upstreamPort} http://127.0.0.1:${upstreamPort}\n`,
            'utf8')
        await writeFile(join(meddleHome, 'settings.json'), JSON.stringify({ activeRuleFiles: ['https-mitm'] }), 'utf8')

        proxyPort = await reservePort()
        proxyProcess = spawn(process.execPath, [join(repoRoot, 'index.js')], {
            cwd: repoRoot,
            env: {
                ...process.env,
                MEDDLE_HOME: meddleHome,
                MEDDLE_HEADLESS: '1',
                MEDDLE_PLUGIN_MODE: 'on',
                MEDDLE_INTERCEPT_HTTPS: '1',
                PORT: String(proxyPort),
                DEBUG: 'proxy',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const output: string[] = []
        proxyProcess.stdout.on('data', (chunk) => output.push(chunk.toString()))
        proxyProcess.stderr.on('data', (chunk) => output.push(chunk.toString()))
        await waitForPort(proxyPort, proxyProcess, output)
    }, 20_000)

    afterAll(async () => {
        if (proxyProcess) await stopProcess(proxyProcess)
        if (upstream) await closeServer(upstream)
        if (meddleHome) await rm(meddleHome, { recursive: true, force: true })
    })

    it('forwards HTTP stream chunks before the upstream response ends', async () => {
        const state = streamStates.get('/stream-http')!
        const result = startHttpProxyRequest(`http://127.0.0.1:${upstreamPort}/stream-http`, state)
        const firstChunk = await withTimeout(result.firstChunk, 1_000, 'HTTP 流式响应首 chunk 超时')
        expect(firstChunk.beforeUpstreamEnd).toBe(true)

        const response = await withTimeout(result.complete, 2_000, 'HTTP 流式响应结束超时')
        expect(response.statusCode).toBe(200)
        expect(response.headers['x-stream-test']).toBe('true')
        expect(response.headers['x-plugin-mutated']).toBeUndefined()
        expect(response.body).toBe('data: first\n\ndata: second\n\ndata: done\n\n')
    })

    it('forwards HTTPS MITM stream chunks before the upstream response ends', async () => {
        const state = streamStates.get('/stream-https')!
        const socket = await connectThroughMitm()
        const result = startRawHttpRequest(socket, '/stream-https')
        const firstChunk = await withTimeout(result.firstChunk, 1_000, 'HTTPS 流式响应首 chunk 超时')
        expect(firstChunk.beforeUpstreamEnd).toBe(true)

        const response = await withTimeout(result.complete, 2_000, 'HTTPS 流式响应结束超时')
        expect(response.statusCode).toBe(200)
        expect(response.headers['x-stream-test']).toBe('true')
        expect(response.headers['x-plugin-mutated']).toBeUndefined()
        expect(response.body).toBe('data: first\n\ndata: second\n\ndata: done\n\n')
        expect(state.ended).toBe(true)
    })

    it('keeps plugin response interception for non-streaming responses', async () => {
        const response = await withTimeout(
            startHttpProxyRequest(`http://127.0.0.1:${upstreamPort}/json`, { ended: true }).complete,
            2_000,
            '普通响应结束超时',
        )
        expect(response.statusCode).toBe(200)
        expect(response.headers['x-plugin-mutated']).toBe('true')
        expect(response.body).toBe('{"original":true}|plugin-mutated')
    })
})

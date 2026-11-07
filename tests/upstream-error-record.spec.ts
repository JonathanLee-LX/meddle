import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Issue #160: connection refused / timeout must land in the traffic list as 502
 * with the failure reason in the detail.
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []
const servers: Array<{ close: (cb?: () => void) => void; listening?: boolean }> = []

afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        if (server.listening === false) return resolve()
        server.close(() => resolve())
    })))
})

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-502-'))
    homes.push(home)
    return home
}

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
}

async function startProxy(home: string, extraEnv: Record<string, string> = {}): Promise<{ base: string; port: number }> {
    const port = await reservePort()
    const child = spawn(process.execPath, [join(repoRoot, 'index.js')], {
        cwd: repoRoot,
        env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1', PORT: String(port), ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    const output: string[] = []
    child.stdout.on('data', (c) => output.push(c.toString()))
    child.stderr.on('data', (c) => output.push(c.toString()))
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`proxy exited early: ${output.join('')}`)
        try {
            const res = await fetch(`${base}/api/logs`)
            if (res.ok) return { base, port }
        } catch { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

function proxyRequest(proxyPort: number, targetUrl: string, method = 'GET'): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl)
        const req = httpRequest({
            host: '127.0.0.1',
            port: proxyPort,
            path: targetUrl,
            method,
            headers: { Host: url.host, Connection: 'close' },
        }, (response: IncomingMessage) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
            response.on('end', () => resolve({
                statusCode: response.statusCode || 0,
                body: Buffer.concat(chunks).toString('utf8'),
            }))
            response.on('error', reject)
        })
        req.on('error', reject)
        req.end()
    })
}

describe('upstream 502 appears in the traffic list (issue #160)', () => {
    it('connection refused is recorded as 502 with the error reason', async () => {
        const home = makeHome()
        const closedPort = await reservePort()
        const { base, port } = await startProxy(home)
        const target = `http://127.0.0.1:${closedPort}/gone`

        const proxied = await proxyRequest(port, target)
        expect(proxied.statusCode).toBe(502)

        const logs = await (await fetch(`${base}/api/logs`)).json() as Array<{ id: number; statusCode: number; source: string; target: string }>
        expect(logs.length).toBeGreaterThan(0)
        const entry = logs.find((item) => item.target === target) || logs[0]
        expect(entry.statusCode).toBe(502)
        expect(entry.source).toBe(target)

        const detail = await (await fetch(`${base}/api/logs/${entry.id}`)).json() as {
            statusCode: number
            statusMessage: string
            error?: string
            responseBody?: string
        }
        expect(detail.statusCode).toBe(502)
        expect(detail.statusMessage).toBe('Bad Gateway')
        expect(detail.error).toMatch(/ECONNREFUSED/)
        expect(detail.responseBody).toMatch(/ECONNREFUSED/)
    }, 30_000)

    it('upstream timeout is recorded as 502 with the timeout reason', async () => {
        const home = makeHome()
        const hanging = createHttpServer((_req, _res) => { /* never respond */ })
        servers.push(hanging)
        await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', () => resolve()))
        const address = hanging.address()
        const hangPort = typeof address === 'object' && address ? address.port : 0
        const { base, port } = await startProxy(home, { MEDDLE_UPSTREAM_TIMEOUT_MS: '400' })
        const target = `http://127.0.0.1:${hangPort}/hang`

        const proxied = await proxyRequest(port, target)
        expect(proxied.statusCode).toBe(502)

        const logs = await (await fetch(`${base}/api/logs`)).json() as Array<{ id: number; statusCode: number; target: string }>
        const entry = logs.find((item) => item.target === target) || logs[0]
        expect(entry.statusCode).toBe(502)
        const detail = await (await fetch(`${base}/api/logs/${entry.id}`)).json() as { error?: string; responseBody?: string }
        expect(`${detail.error || ''} ${detail.responseBody || ''}`).toMatch(/超时|UPSTREAM_TIMEOUT|timeout/i)
    }, 30_000)

    it('a successful upstream response is still recorded as 200', async () => {
        const home = makeHome()
        const upstream = createHttpServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('ok')
        })
        servers.push(upstream)
        await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
        const address = upstream.address()
        const upPort = typeof address === 'object' && address ? address.port : 0
        const { base, port } = await startProxy(home)
        const target = `http://127.0.0.1:${upPort}/ok`

        const proxied = await proxyRequest(port, target)
        expect(proxied.statusCode).toBe(200)
        expect(proxied.body).toBe('ok')

        const logs = await (await fetch(`${base}/api/logs`)).json() as Array<{ statusCode: number; target: string }>
        const entry = logs.find((item) => item.target === target) || logs[0]
        expect(entry.statusCode).toBe(200)
    }, 30_000)
})

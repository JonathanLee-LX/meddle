import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import { cleanHeadersForH2, makeProxyRequest, __setH2SessionFactoryForTest } from '../core/h2-pool'

const servers: http.Server[] = []
const sockets = new Set<import('node:net').Socket>()

afterEach(async () => {
    for (const s of sockets) s.destroy()
    sockets.clear()
    await Promise.all(servers.splice(0).map(s => new Promise<void>(r => {
        if (s.listening) s.close(() => r())
        else r()
    })))
})

function listen(server: http.Server): Promise<number> {
    servers.push(server)
    return new Promise(async (resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        resolve((server.address() as AddressInfo).port)
    })
}

describe('h2-pool cleanHeadersForH2', () => {
    it('removes hop-by-hop headers', () => {
        const input = {
            'Connection': 'keep-alive',
            'Keep-Alive': '5',
            'Transfer-Encoding': 'chunked',
            'Host': 'example.com',
            'content-type': 'text/html',
            'x-custom': 'value',
        }
        const result = cleanHeadersForH2(input)
        expect(result['connection']).toBe(undefined)
        expect(result['keep-alive']).toBe(undefined)
        expect(result['transfer-encoding']).toBe(undefined)
        expect(result['host']).toBe(undefined)
        expect(result['content-type']).toBe('text/html')
        expect(result['x-custom']).toBe('value')
    })

    it('removes pseudo-headers (starting with :)', () => {
        const input = {
            ':method': 'GET',
            ':path': '/foo',
            ':authority': 'example.com',
            'accept': '*/*',
        }
        const result = cleanHeadersForH2(input)
        expect(result[':method']).toBe(undefined)
        expect(result[':path']).toBe(undefined)
        expect(result['accept']).toBe('*/*')
    })

    it('lowercases all remaining header keys', () => {
        const result = cleanHeadersForH2({ 'Content-Type': 'text/html', 'X-Custom-Header': 'val' })
        expect('content-type' in result).toBeTruthy()
        expect('x-custom-header' in result).toBeTruthy()
        expect(result['Content-Type']).toBe(undefined)
    })

    it('returns empty object for empty input', () => {
        expect(cleanHeadersForH2({})).toEqual({})
    })

    it('removes proxy-related headers', () => {
        const input = {
            'proxy-authenticate': 'Basic',
            'proxy-authorization': 'Bearer token',
            'te': 'gzip',
            'trailer': 'Expires',
            'upgrade': 'h2c',
            'accept': 'text/html',
        }
        const result = cleanHeadersForH2(input)
        expect(result['proxy-authenticate']).toBe(undefined)
        expect(result['proxy-authorization']).toBe(undefined)
        expect(result['te']).toBe(undefined)
        expect(result['trailer']).toBe(undefined)
        expect(result['upgrade']).toBe(undefined)
        expect(result['accept']).toBe('text/html')
    })
})

describe('h2-pool makeProxyRequest upstream timeout', () => {    it('fails with a stable UPSTREAM_TIMEOUT code and a descriptive message', async () => {
        // Upstream accepts the connection but never responds → idle timeout.
        const s = http.createServer((_req, res) => {
            // hold the connection open without sending anything
            const hold = setInterval(() => {}, 1000)
            res.on('close', () => clearInterval(hold))
        })
        const port = await listen(s)

        process.env.MEDDLE_UPSTREAM_TIMEOUT_MS = '300'
        try {
            await expect(
                makeProxyRequest(`http://127.0.0.1:${port}/never`, 'GET', { host: '127.0.0.1' }, Buffer.alloc(0)),
            ).rejects.toMatchObject({
                code: 'UPSTREAM_TIMEOUT',
            })
        } finally {
            delete process.env.MEDDLE_UPSTREAM_TIMEOUT_MS
        }
    }, 30000)

    it('mentions the target URL in the timeout message', async () => {
        const s = http.createServer((_req, res) => {
            const hold = setInterval(() => {}, 1000)
            res.on('close', () => clearInterval(hold))
        })
        const port = await listen(s)

        process.env.MEDDLE_UPSTREAM_TIMEOUT_MS = '300'
        try {
            await expect(
                makeProxyRequest(`http://127.0.0.1:${port}/api/x`, 'GET', { host: '127.0.0.1' }, Buffer.alloc(0)),
            ).rejects.toThrow(/127\.0\.0\.1/)
        } finally {
            delete process.env.MEDDLE_UPSTREAM_TIMEOUT_MS
        }
    }, 30000)

    it('does not crash when a pooled H2 session errors more than once', async () => {
        // Regression: getOrCreateH2Session attached `once('error')`. The first
        // error consumed the listener; a second 'error' emission on the same
        // session (e.g. an RST while a caller still holds it) then had no
        // listener → uncaughtException killed the whole proxy. The listener
        // must persist and the errored session must be destroyed.
        const { generateKeyPairSync } = await import('node:crypto')
        const { execFileSync } = await import('node:child_process')
        const fs = await import('node:fs')
        const os = await import('node:os')
        const path = await import('node:path')

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2pool-'))
        const keyPath = path.join(dir, 'key.pem')
        const crtPath = path.join(dir, 'cert.pem')
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
        fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
        execFileSync('openssl', ['req', '-x509', '-new', '-key', keyPath, '-out', crtPath,
            '-days', '1', '-subj', '/CN=localhost', '-nodes'], { stdio: 'pipe' })

        // Fake http2 session: emits connect, then lets the test emit 'error' repeatedly.
        let fakeSession: (EventEmitter & { destroyed: boolean; closed: boolean; destroy(): void }) | null = null
        __setH2SessionFactoryForTest(() => {
            const s = new EventEmitter() as EventEmitter & {
                destroyed: boolean; closed: boolean; destroy(): void
            }
            s.destroyed = false
            s.closed = false
            s.destroy = () => { s.destroyed = true; s.closed = true }
            fakeSession = s
            return s as unknown as import('node:http2').ClientHttp2Session
        })

        let uncaught: Error | null = null
        const onUncaught = (e: Error) => { uncaught = e }
        process.on('uncaughtException', onUncaught)

        try {
            // Trigger session creation.
            const reqPromise = makeProxyRequest(
                'https://127.0.0.1:1/', 'GET', { host: '127.0.0.1:1' }, Buffer.alloc(0),
            ).catch(() => { /* session errors reject the request */ })
            await new Promise<void>((r) => setTimeout(r, 50))
            expect(fakeSession).not.toBeNull()
            fakeSession!.emit('connect')

            // First error: handled (rejects the pending request).
            fakeSession!.emit('error', new Error('first ECONNRESET'))
            await new Promise<void>((r) => setTimeout(r, 50))
            expect(uncaught).toBeNull()
            expect(fakeSession!.destroyed).toBe(true)

            // Second error on the same session must NOT crash the process.
            fakeSession!.emit('error', new Error('second ECONNRESET'))
            await new Promise<void>((r) => setTimeout(r, 50))
            expect(uncaught).toBeNull()

            await reqPromise
        } finally {
            process.removeListener('uncaughtException', onUncaught)
            __setH2SessionFactoryForTest(null)
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }, 30000)
})

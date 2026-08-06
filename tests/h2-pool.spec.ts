import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { cleanHeadersForH2, makeProxyRequest } from '../core/h2-pool'

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

describe('h2-pool makeProxyRequest upstream timeout', () => {
    it('fails with a stable UPSTREAM_TIMEOUT code and a descriptive message', async () => {
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
})

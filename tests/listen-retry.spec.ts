import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'net'
import { createServer as createHttpServer } from 'http'
import type { AddressInfo } from 'net'
import { listenWithRetry } from '../helpers'

const servers: ReturnType<typeof createServer>[] = []
const httpServers: ReturnType<typeof createHttpServer>[] = []

afterEach(async () => {
    await Promise.all(httpServers.splice(0).map(s => new Promise<void>(r => {
        if (s.listening) s.close(() => r())
        else r()
    })))
    await Promise.all(servers.splice(0).map(s => new Promise<void>(r => {
        if (s.listening) s.close(() => r())
        else r()
    })))
})

function listen(server: ReturnType<typeof createServer> | ReturnType<typeof createHttpServer>): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (e: Error) => reject(e)
        server.once('error', onError)
        server.listen(0, '127.0.0.1', () => {
            server.off('error', onError)
            resolve((server.address() as AddressInfo).port)
        })
    })
}

describe('helpers.listenWithRetry', () => {
    it('listens on the requested port when free', async () => {
        const server = createHttpServer()
        httpServers.push(server)
        const port = await listenWithRetry(server, '127.0.0.1', 0, { maxRetries: 2 })
        expect(server.listening).toBe(true)
        expect(port).toBe((server.address() as AddressInfo).port)
    })

    it('retries with a new port when the requested port is taken', async () => {
        const blocker = createServer()
        servers.push(blocker)
        const blockerPort = await listen(blocker)

        const server = createHttpServer()
        httpServers.push(server)
        const port = await listenWithRetry(server, '127.0.0.1', blockerPort, { maxRetries: 3 })
        expect(server.listening).toBe(true)
        expect(port).not.toBe(blockerPort)
    })

    it('gives up and rejects when the port stays taken', async () => {
        const blocker = createServer()
        servers.push(blocker)
        const blockerPort = await listen(blocker)

        const server = createHttpServer()
        httpServers.push(server)
        await expect(listenWithRetry(server, '127.0.0.1', blockerPort, { maxRetries: 0 }))
            .rejects.toThrow(/EADDRINUSE|listen/i)
    })
})

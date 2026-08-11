import { once } from 'events'
import { createServer, connect, type Socket } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { isExpectedSocketError, wireMitmClientSocket } from '../core/mitm-socket'

const sockets = new Set<Socket>()
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()

    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
        server.close(() => resolve())
    })))
})

describe('MITM TLS client socket wiring', () => {
    async function createSocketPair(): Promise<{ proxySide: Socket; clientSide: Socket }> {
        const server = createServer(socket => {
            sockets.add(socket)
            serverProxySide = socket
        })
        servers.push(server)
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')

        const clientSide = connect(server.address() as { port: number; address: string })
        sockets.add(clientSide)
        await once(clientSide, 'connect')

        return { proxySide: serverProxySide!, clientSide }
    }

    let serverProxySide: Socket | undefined

    it('attaches a persistent error listener to the MITM client socket', async () => {
        const { proxySide } = await createSocketPair()

        const tracked: Socket[] = []
        const untracked: Socket[] = []
        wireMitmClientSocket(proxySide, {
            onTrack: () => tracked.push(proxySide),
            onUntrack: () => untracked.push(proxySide),
            attachIdentity: () => {},
            onUnexpectedError: () => {},
        })

        expect(tracked).toContain(proxySide)
        expect(proxySide.listenerCount('error')).toBeGreaterThan(0)
    })

    it('keeps the error listener after the first error (no uncaughtException on repeated errors)', async () => {
        // Regression: a MITM TLS socket with no 'error' listener would surface
        // a client ECONNRESET as uncaughtException and kill the whole proxy
        // (observed in the deno binary). The listener must persist across
        // multiple emissions — `once` would be consumed by the first error.
        const { proxySide } = await createSocketPair()
        const unexpectedErrors: Error[] = []
        wireMitmClientSocket(proxySide, {
            onTrack: () => {},
            onUntrack: () => {},
            attachIdentity: () => {},
            onUnexpectedError: err => unexpectedErrors.push(err),
        })

        const listenerCountBefore = proxySide.listenerCount('error')
        expect(listenerCountBefore).toBeGreaterThan(0)

        let uncaught: Error | null = null
        const onUncaught = (err: Error) => { uncaught = err }
        process.on('uncaughtException', onUncaught)

        try {
            // First error: a routine client reset (ECONNRESET) must be swallowed.
            proxySide.emit('error', Object.assign(new Error('first ECONNRESET'), { code: 'ECONNRESET' }))
            await new Promise<void>(r => setTimeout(r, 30))
            expect(uncaught).toBeNull()
            expect(unexpectedErrors).toHaveLength(0)

            // Second error must still be handled (persistent listener).
            proxySide.emit('error', Object.assign(new Error('second ECONNRESET'), { code: 'ECONNRESET' }))
            await new Promise<void>(r => setTimeout(r, 30))
            expect(uncaught).toBeNull()
            expect(proxySide.listenerCount('error')).toBe(listenerCountBefore)

            // An unexpected error is reported to the handler but never crashes.
            proxySide.emit('error', Object.assign(new Error('ECONNABORTED'), { code: 'ECONNABORTED' }))
            await new Promise<void>(r => setTimeout(r, 30))
            expect(uncaught).toBeNull()
            expect(unexpectedErrors.map(err => err.message)).toContain('ECONNABORTED')
        } finally {
            process.removeListener('uncaughtException', onUncaught)
        }
    })

    it('untracks the socket on close', async () => {
        const { proxySide, clientSide } = await createSocketPair()
        const untracked: Socket[] = []
        wireMitmClientSocket(proxySide, {
            onTrack: () => {},
            onUntrack: () => untracked.push(proxySide),
            attachIdentity: () => {},
            onUnexpectedError: () => {},
        })

        clientSide.destroy()
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('socket was not closed')), 1000)
            const poll = (): void => {
                if (proxySide.destroyed) {
                    clearTimeout(timeout)
                    resolve()
                    return
                }
                setTimeout(poll, 5)
            }
            poll()
        })

        expect(untracked).toContain(proxySide)
    })

    it('classifies routine client reset errors', () => {
        expect(isExpectedSocketError({ code: 'ECONNRESET' })).toBe(true)
        expect(isExpectedSocketError({ code: 'EPIPE' })).toBe(true)
        expect(isExpectedSocketError({ code: 'ECONNABORTED' })).toBe(false)
        expect(isExpectedSocketError(new Error('failed'))).toBe(false)
    })
})

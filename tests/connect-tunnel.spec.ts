import { once } from 'events'
import { createServer, connect, type Socket } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import {
    CONNECT_ESTABLISHED_RESPONSE,
    establishConnectTunnel,
    isExpectedSocketError,
} from '../core/connect-tunnel'

const sockets = new Set<Socket>()
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()

    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
        server.close(() => resolve())
    })))
})

describe('CONNECT tunnel bridge', () => {
    it('forwards CONNECT head bytes before later client data', async () => {
        let upstreamSocket: Socket | undefined
        const upstreamData: Buffer[] = []
        const upstream = createServer(socket => {
            upstreamSocket = socket
            sockets.add(socket)
            socket.on('data', chunk => upstreamData.push(chunk))
        })
        servers.push(upstream)
        upstream.listen(0, '127.0.0.1')
        await once(upstream, 'listening')

        const proxy = createServer(client => {
            sockets.add(client)
            const target = connect(upstream.address() as { port: number; address: string })
            sockets.add(target)
            target.once('connect', () => {
                establishConnectTunnel(client, target, Buffer.from('client-hello'))
            })
        })
        servers.push(proxy)
        proxy.listen(0, '127.0.0.1')
        await once(proxy, 'listening')

        const client = connect(proxy.address() as { port: number; address: string })
        sockets.add(client)
        await once(client, 'connect')

        let response = ''
        client.on('data', chunk => {
            response += chunk.toString()
            if (response.includes('\r\n\r\n')) client.write('later-data')
        })

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('tunnel data timeout')), 1000)
            const poll = (): void => {
                const data = Buffer.concat(upstreamData).toString()
                if (data === 'client-hellolater-data') {
                    clearTimeout(timeout)
                    resolve()
                    return
                }
                setTimeout(poll, 5)
            }
            poll()
        })

        expect(response).toBe(CONNECT_ESTABLISHED_RESPONSE)
        expect(upstreamSocket).toBeDefined()
    })

    it('classifies routine client disconnect errors', () => {
        expect(isExpectedSocketError({ code: 'ECONNRESET' })).toBe(true)
        expect(isExpectedSocketError({ code: 'EPIPE' })).toBe(true)
        expect(isExpectedSocketError({ code: 'ECONNREFUSED' })).toBe(false)
        expect(isExpectedSocketError(new Error('failed'))).toBe(false)
    })
})

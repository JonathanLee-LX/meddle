import type { Socket } from 'net'

export const CONNECT_ESTABLISHED_RESPONSE =
    'HTTP/1.1 200 Connection Established\r\nProxy-Agent: easy-proxy\r\n\r\n'

export function isExpectedSocketError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) return false
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ECONNRESET' || code === 'EPIPE'
}

export function establishConnectTunnel(
    client: Socket,
    upstream: Socket,
    head: Buffer,
    response: string = CONNECT_ESTABLISHED_RESPONSE,
): void {
    if (client.destroyed || upstream.destroyed) {
        if (!upstream.destroyed) upstream.destroy()
        return
    }

    client.write(response, () => {
        if (client.destroyed || upstream.destroyed) {
            if (!upstream.destroyed) upstream.destroy()
            return
        }

        if (head.length > 0) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
    })
}

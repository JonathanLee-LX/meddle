import type { Socket } from 'net'

export const CONNECT_ESTABLISHED_RESPONSE =
    'HTTP/1.1 200 Connection Established\r\nProxy-Agent: meddle\r\n\r\n'

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
    let closed = false
    const closeBoth = (): void => {
        if (closed) return
        closed = true

        client.unpipe(upstream)
        upstream.unpipe(client)
        if (!client.destroyed) client.destroy()
        if (!upstream.destroyed) upstream.destroy()
    }

    if (client.destroyed || upstream.destroyed) {
        closeBoth()
        return
    }

    client.write(response, () => {
        if (client.destroyed || upstream.destroyed) {
            closeBoth()
            return
        }

        client.once('close', closeBoth)
        upstream.once('close', closeBoth)
        client.once('error', closeBoth)
        upstream.once('error', closeBoth)

        if (head.length > 0) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
    })
}

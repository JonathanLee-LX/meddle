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
        // Persistent error listeners: a tunnel socket can emit 'error' more
        // than once (e.g. an RST while the other side is still draining). With
        // `once` the listener would be consumed by the first error and a second
        // emission would crash the process via uncaughtException (observed in
        // the deno binary). `on` keeps the bridge protected for the socket's
        // lifetime; closeBoth is idempotent.
        client.on('error', closeBoth)
        upstream.on('error', closeBoth)

        if (head.length > 0) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
    })
}

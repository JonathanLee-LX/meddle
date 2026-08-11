import type { Socket } from 'net'
import { isExpectedSocketError } from './connect-tunnel'

export { isExpectedSocketError }

export interface MitmClientSocketOptions {
    /** Called once when the socket is accepted (tracking). */
    onTrack: () => void
    /** Called once when the socket closes (untracking). */
    onUntrack: () => void
    /** Attach per-connection metadata (e.g. client identity registry). */
    attachIdentity: (socket: Socket) => void
    /** Report non-routine errors (ECONNRESET/EPIPE are swallowed). */
    onUnexpectedError?: (err: NodeJS.ErrnoException) => void
}

/**
 * Wire the per-connection MITM TLS socket.
 *
 * A client resetting its TLS connection (ECONNRESET) can surface as an
 * 'error' on the socket. Without a persistent listener the error propagates
 * to uncaughtException and kills the whole proxy (observed in the deno
 * binary). The listener is `on` (not `once`) because a socket can emit
 * 'error' more than once; `once` would be consumed by the first error and a
 * second emission would have no listener.
 */
export function wireMitmClientSocket(tlsSocket: Socket, options: MitmClientSocketOptions): void {
    options.onTrack()
    tlsSocket.once('close', () => { options.onUntrack() })
    options.attachIdentity(tlsSocket)
    tlsSocket.on('error', (err: NodeJS.ErrnoException) => {
        if (!isExpectedSocketError(err)) options.onUnexpectedError?.(err)
    })
}

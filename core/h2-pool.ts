import * as http from 'http'
import * as https from 'https'
import * as http2 from 'http2'
import _debug from 'debug'
import type { ProxyResponse } from './types'

const proxyDebug = _debug('proxy')

const h2SessionPool = new Map<string, http2.ClientHttp2Session>()
const UPSTREAM_REQUEST_TIMEOUT_MS = 60000

const HOP_BY_HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'
])

export function cleanHeadersForH2(headers: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(headers)) {
        const lk = key.toLowerCase()
        if (!HOP_BY_HOP_HEADERS.has(lk) && !lk.startsWith(':')) {
            cleaned[lk] = value
        }
    }
    return cleaned
}

function getOrCreateH2Session(origin: string, servername?: string): Promise<http2.ClientHttp2Session> {
    const poolKey = servername ? `${origin}#${servername}` : origin
    const cached = h2SessionPool.get(poolKey)
    if (cached && !cached.closed && !cached.destroyed) {
        return Promise.resolve(cached)
    }
    h2SessionPool.delete(poolKey)

    return new Promise((resolve, reject) => {
        const connectOpts: http2.SecureClientSessionOptions = { rejectUnauthorized: false }
        if (servername) connectOpts.servername = servername
        const session = http2.connect(origin, connectOpts)

        const timeout = setTimeout(() => {
            session.destroy()
            reject(new Error('HTTP/2 connection timeout'))
        }, 5000)

        session.once('connect', () => {
            clearTimeout(timeout)
            h2SessionPool.set(poolKey, session)
            resolve(session)
        })

        session.once('error', (err: Error) => {
            clearTimeout(timeout)
            h2SessionPool.delete(poolKey)
            reject(err)
        })

        session.on('close', () => { h2SessionPool.delete(poolKey) })
        session.on('goaway', () => {
            h2SessionPool.delete(poolKey)
            if (!session.destroyed) session.destroy()
        })
        session.setTimeout(60000, () => {
            h2SessionPool.delete(poolKey)
            if (!session.destroyed) session.close()
        })
    })
}

function proxyViaH2(target: string, method: string, headers: Record<string, any>, reqBody: Buffer): Promise<ProxyResponse> {
    const url = new URL(target)
    const origin = url.origin
    const originalHost: string = headers.host || headers.Host || headers[':authority'] || url.host
    const originalHostname = originalHost.split(':')[0]
    const servername = (url.hostname !== originalHostname) ? originalHostname : undefined

    return getOrCreateH2Session(origin, servername).then(session => {
        return new Promise<ProxyResponse>((resolve, reject) => {
            try {
                const h2Headers: Record<string, any> = cleanHeadersForH2(headers)
                h2Headers[':method'] = method
                h2Headers[':path'] = url.pathname + url.search
                h2Headers[':authority'] = originalHost
                h2Headers[':scheme'] = url.protocol.replace(':', '')

                const h2Stream = session.request(h2Headers)
                h2Stream.on('response', (resHeaders: http2.IncomingHttpHeaders) => {
                    const statusCode = Number(resHeaders[':status'])
                    const clean: Record<string, any> = {}
                    for (const [k, v] of Object.entries(resHeaders)) {
                        if (!k.startsWith(':')) clean[k] = v
                    }
                    resolve({ statusCode, statusMessage: '', headers: clean, stream: h2Stream, protocol: 'h2' })
                })
                h2Stream.on('error', reject)
                if (reqBody && reqBody.length > 0) h2Stream.write(reqBody)
                h2Stream.end()
            } catch (err) { reject(err) }
        })
    })
}

function proxyViaH1(target: string, method: string, headers: Record<string, any>, reqBody: Buffer): Promise<ProxyResponse> {
    const url = new URL(target)
    const requestFn = url.protocol === 'https:' ? https.request : http.request

    const h1Headers: Record<string, any> = {}
    const originalHost: string = headers[':authority'] || headers.host || headers.Host || url.host
    for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase()
        if (!key.startsWith(':') && normalized !== 'proxy-authorization' && normalized !== 'proxy-connection') {
            h1Headers[key] = value
        }
    }
    if (!h1Headers.host && !h1Headers.Host) h1Headers.host = originalHost

    return new Promise((resolve, reject) => {
        const proxyReq = requestFn(target, { method, headers: h1Headers, rejectUnauthorized: false } as any, (proxyRes: http.IncomingMessage) => {
            resolve({
                statusCode: proxyRes.statusCode!,
                statusMessage: proxyRes.statusMessage || '',
                headers: proxyRes.headers as Record<string, any>,
                stream: proxyRes,
                protocol: 'h1.1'
            })
        })
        proxyReq.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
            proxyReq.destroy(new Error('HTTP/1.1 upstream request timeout'))
        })
        proxyReq.on('error', reject)
        if (reqBody && reqBody.length > 0) proxyReq.write(reqBody)
        proxyReq.end()
    })
}

export async function makeProxyRequest(target: string, method: string, headers: Record<string, any>, reqBody: Buffer): Promise<ProxyResponse> {
    if (target.startsWith('https')) {
        try {
            return await proxyViaH2(target, method, headers, reqBody)
        } catch (err: any) {
            proxyDebug('HTTP/2 请求失败，回退到 HTTP/1.1:', err.message)
            return proxyViaH1(target, method, headers, reqBody)
        }
    }
    return proxyViaH1(target, method, headers, reqBody)
}

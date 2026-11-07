import type { ProxyContext, ProxyRecord, ProxyRecordDetail } from './types'

export function formatUpstreamError(err: unknown): string {
    if (err == null) return 'Bad Gateway'
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code || '') : ''
    const message = err instanceof Error ? err.message : String(err)
    if (code && message && !message.includes(code)) return `${code}: ${message}`
    return message || code || 'Bad Gateway'
}

export interface UpstreamErrorRecordInput {
    method: string
    source: string
    target: string
    startTime: number
    clientIdentity?: Record<string, unknown>
    requestHeaders?: ProxyRecordDetail['requestHeaders']
    requestBody?: string
    err: unknown
    statusCode?: number
}

/** Record a proxied request that never got an upstream response (issue #160). */
export function appendUpstreamErrorRecord(ctx: ProxyContext, input: UpstreamErrorRecordInput): void {
    const statusCode = input.statusCode ?? 502
    const reason = formatUpstreamError(input.err)
    const recordId = ctx.recordIdSeq++
    const logData: ProxyRecord = {
        id: recordId,
        method: input.method,
        source: input.source,
        target: input.target,
        time: new Date().toLocaleTimeString(),
        statusCode,
        duration: Math.max(0, Date.now() - input.startTime),
        ...(input.clientIdentity || {}),
    }
    const detail: ProxyRecordDetail = {
        requestHeaders: input.requestHeaders || {},
        requestBody: input.requestBody || '',
        responseHeaders: {},
        responseBody: reason,
        statusCode,
        statusMessage: 'Bad Gateway',
        method: input.method,
        url: input.source,
        error: reason,
    }
    appendProxyRecord(ctx, logData, detail)
}

export function appendProxyRecord(
    ctx: ProxyContext,
    logData: ProxyRecord,
    detail?: ProxyRecordDetail,
): void {
    try {
        if (ctx.localWSServer) {
            ctx.localWSServer.clients.forEach((client: any) => {
                if (client.readyState === undefined || client.readyState === 1) {
                    client.send(JSON.stringify(logData))
                }
            })
        }
    } catch (_) { /* ignore */ }

    ctx.proxyRecordArr.push(logData)
    if (ctx.proxyRecordArr.length > ctx.MAX_RECORD_SIZE) {
        const removed = ctx.proxyRecordArr.shift()
        if (removed && removed.id !== undefined) {
            ctx.proxyRecordDetailMap.delete(removed.id)
        }
    }

    if (!detail || logData.id === undefined) return

    ctx.proxyRecordDetailMap.set(logData.id, detail)
    if (ctx.proxyRecordDetailMap.size > ctx.MAX_DETAIL_SIZE) {
        const firstKey = ctx.proxyRecordDetailMap.keys().next().value
        if (firstKey !== undefined) {
            ctx.proxyRecordDetailMap.delete(firstKey)
        }
    }
}

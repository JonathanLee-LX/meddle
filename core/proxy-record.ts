import type { ProxyContext, ProxyRecord, ProxyRecordDetail } from './types'

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

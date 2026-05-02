import type { ProxyContext, ProxyRecord, ProxyRecordDetail } from './types'

/**
 * Append a proxy record and its detail to the context.
 * Handles both in-memory and file-based body storage.
 */
export function appendProxyRecord(
    ctx: ProxyContext,
    logData: ProxyRecord,
    detail?: ProxyRecordDetail,
): void {
    // Broadcast to WebSocket clients
    try {
        if (ctx.localWSServer) {
            ctx.localWSServer.clients.forEach((client: any) => {
                if (client.readyState === undefined || client.readyState === 1) {
                    client.send(JSON.stringify(logData))
                }
            })
        }
    } catch (_) { /* ignore */ }

    // Add to record array
    ctx.proxyRecordArr.push(logData)

    // Remove oldest records if over limit
    if (ctx.proxyRecordArr.length > ctx.MAX_RECORD_SIZE) {
        const removed = ctx.proxyRecordArr.shift()
        if (removed && removed.id !== undefined) {
            // Delete from detail map
            ctx.proxyRecordDetailMap.delete(removed.id)
            // Delete cached body files
            if (ctx.bodyCacheManager) {
                ctx.bodyCacheManager.deleteBody(removed.id)
            }
        }
    }

    // No detail to store
    if (!detail || logData.id === undefined) return

    // Store detail with potential body caching
    const processedDetail = processDetail(ctx, logData.id, detail)
    ctx.proxyRecordDetailMap.set(logData.id, processedDetail)

    // Remove oldest details if over limit
    if (ctx.proxyRecordDetailMap.size > ctx.MAX_DETAIL_SIZE) {
        const firstKey = ctx.proxyRecordDetailMap.keys().next().value
        if (firstKey !== undefined) {
            ctx.proxyRecordDetailMap.delete(firstKey)
            // Delete cached body files for removed record
            if (ctx.bodyCacheManager) {
                ctx.bodyCacheManager.deleteBody(firstKey)
            }
        }
    }
}

/**
 * Process detail - handle large body storage
 */
function processDetail(
    ctx: ProxyContext,
    recordId: number,
    detail: ProxyRecordDetail
): ProxyRecordDetail {
    const result: ProxyRecordDetail = {
        requestHeaders: detail.requestHeaders,
        responseHeaders: detail.responseHeaders,
        statusCode: detail.statusCode,
        statusMessage: detail.statusMessage,
        method: detail.method,
        url: detail.url,
        inspection: detail.inspection,
    }

    // Handle request body
    if (detail.requestBody && ctx.bodyCacheManager) {
        const threshold = ctx.BODY_MEMORY_THRESHOLD || 100 * 1024
        const size = Buffer.byteLength(detail.requestBody, 'utf8')
        result.requestBodySize = size

        if (size >= threshold) {
            // Store large body to file
            const contentType = getContentType(detail.requestHeaders)
            const storeResult = ctx.bodyCacheManager.storeBody(recordId, 'request', detail.requestBody, contentType)
            if (!storeResult.inMemory && storeResult.path) {
                result.requestBodyCachePath = storeResult.path
                // Don't store body in memory
            } else {
                // Fallback to memory if file storage failed
                result.requestBody = detail.requestBody
            }
        } else {
            // Small body stays in memory
            result.requestBody = detail.requestBody
        }
    }

    // Handle response body
    if (detail.responseBody && ctx.bodyCacheManager) {
        const threshold = ctx.BODY_MEMORY_THRESHOLD || 100 * 1024
        const size = Buffer.byteLength(detail.responseBody, 'utf8')
        result.responseBodySize = size

        if (size >= threshold) {
            // Store large body to file
            const contentType = getContentType(detail.responseHeaders)
            const storeResult = ctx.bodyCacheManager.storeBody(recordId, 'response', detail.responseBody, contentType)
            if (!storeResult.inMemory && storeResult.path) {
                result.responseBodyCachePath = storeResult.path
                // Don't store body in memory
            } else {
                // Fallback to memory if file storage failed
                result.responseBody = detail.responseBody
            }
        } else {
            // Small body stays in memory
            result.responseBody = detail.responseBody
        }
    }

    return result
}

/**
 * Extract content type from headers
 */
function getContentType(headers: Record<string, string | string[] | undefined>): string {
    const ct = headers['content-type'] || headers['Content-Type']
    if (Array.isArray(ct)) {
        return ct[0] || 'application/octet-stream'
    }
    return ct || 'application/octet-stream'
}

/**
 * Read body from memory or cache file
 */
export function readBody(
    ctx: ProxyContext,
    recordId: number,
    type: 'request' | 'response'
): string | null {
    const detail = ctx.proxyRecordDetailMap.get(recordId)
    if (!detail) return null

    const memoryBody = type === 'request' ? detail.requestBody : detail.responseBody
    const cachePath = type === 'request' ? detail.requestBodyCachePath : detail.responseBodyCachePath

    // If we have in-memory body, return it
    if (memoryBody) return memoryBody

    // If we have cache path, read from file
    if (cachePath && ctx.bodyCacheManager) {
        return ctx.bodyCacheManager.readBody(recordId, type)
    }

    return null
}

/**
 * Get cache statistics
 */
export function getCacheStats(ctx: ProxyContext): {
    totalSize: number
    fileCount: number
    memoryEntries: number
} {
    const cacheStats = ctx.bodyCacheManager ? ctx.bodyCacheManager.getStats() : { totalSize: 0, fileCount: 0 }
    return {
        totalSize: cacheStats.totalSize,
        fileCount: cacheStats.fileCount,
        memoryEntries: ctx.proxyRecordDetailMap.size,
    }
}
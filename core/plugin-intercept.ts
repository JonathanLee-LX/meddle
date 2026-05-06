import * as zlib from 'zlib'
import _debug from 'debug'
import type { ProxyContext, InterceptOptions } from './types'
import { dispatchWithInspection } from './inspection-dispatch'

const proxyDebug = _debug('proxy')

export function createPluginIntercept(ctx: ProxyContext) {
    function isTextContentType(ct: string): boolean {
        if (!ct) return false
        const lower = ct.toLowerCase()
        return lower.includes('text/') ||
            lower.includes('application/json') ||
            lower.includes('application/javascript') ||
            lower.includes('application/xml') ||
            lower.includes('application/xhtml') ||
            lower.includes('+json') ||
            lower.includes('+xml')
    }

    function decompressBuffer(buf: Buffer, encoding: string): Buffer {
        if (!encoding) return buf
        try {
            if (encoding === 'gzip') return zlib.gunzipSync(buf)
            if (encoding === 'deflate') return zlib.inflateSync(buf)
            if (encoding === 'br') return zlib.brotliDecompressSync(buf)
        } catch (_) { /* ignore */ }
        return buf
    }

    function shouldInterceptResponse(): boolean {
        return ctx.requestPipeline.mode === 'on'
    }

    async function interceptResponseWithPlugins(opts: InterceptOptions): Promise<boolean> {
        const { req, res, source, target, startTime, statusCode, headers, bodyBuffer, reqBody, inspectionMeta, cleanHeaders } = opts
        const contentType: string = headers['content-type'] || ''
        const contentEncoding: string = headers['content-encoding'] || ''

        if (!isTextContentType(contentType)) return false

        let bodyStr: string
        try {
            const decompressed = decompressBuffer(bodyBuffer, contentEncoding)
            bodyStr = decompressed.toString('utf-8')
        } catch (_) { return false }

        const pluginLogger = {
            debug: (...a: any[]) => console.debug('[plugin]', ...a),
            log: (...a: any[]) => console.log('[plugin]', ...a),
            info: (...a: any[]) => console.log('[plugin]', ...a),
            warn: (...a: any[]) => console.warn('[plugin]', ...a),
            error: (...a: any[]) => console.error('[plugin]', ...a),
        }

        const hdrs = { ...headers }
        const responseCtx = {
            log: pluginLogger,
            request: {
                method: req.method as string, url: source,
                headers: req.headers || {},
                body: reqBody ? reqBody.toString('utf-8') : '',
            },
            target,
            meta: { ...(inspectionMeta || {}), _pluginRequestStartAt: startTime },
            response: { statusCode, headers: hdrs, body: bodyStr },
        }

        try { await dispatchWithInspection(ctx.hookDispatcher, console, 'onBeforeResponse', responseCtx) }
        catch (e) { console.error('[plugin] onBeforeResponse hook error:', e) }

        const finalBody = Buffer.from(responseCtx.response.body, 'utf-8')
        const finalHeaders: Record<string, any> = { ...responseCtx.response.headers }
        delete finalHeaders['content-encoding']
        finalHeaders['content-length'] = String(finalBody.length)

        const finalWriteHeaders = cleanHeaders ? cleanHeaders(finalHeaders) : finalHeaders
        res.writeHead(responseCtx.response.statusCode, finalWriteHeaders)
        res.end(finalBody)

        try { await dispatchWithInspection(ctx.hookDispatcher, console, 'onAfterResponse', responseCtx) } catch (_) { /* ignore */ }
        return true
    }

    function emitLegacyResponseToPlugins(logData: { method: string; source: string; statusCode?: number; duration?: number }): void {
        const startContext = {
            request: { method: logData.method, url: logData.source, headers: {}, body: '' },
            meta: { _pluginRequestStartAt: Date.now() - (logData.duration || 0), source: 'legacy-bridge' },
        }
        const responseContext = {
            request: { method: logData.method, url: logData.source, headers: {}, body: '' },
            response: { statusCode: logData.statusCode, headers: {}, body: '' },
            meta: { _pluginRequestStartAt: Date.now() - (logData.duration || 0), source: 'legacy-bridge' },
        }
        ctx.hookDispatcher.dispatch('onRequestStart', startContext)
            .then(() => ctx.hookDispatcher.dispatch('onAfterResponse', responseContext))
            .catch(() => { /* ignore */ })
    }

    function emitLegacyErrorToPlugins(phase: string, error: any): void {
        ctx.hookDispatcher.dispatch('onError', { phase, error, meta: { source: 'legacy-bridge' } }).catch(() => { /* ignore */ })
    }

    function observeShadowDecision(method: string, source: string, baseTarget: string, observedTarget: string): void {
        const isDiff = ctx.shadowCompareTracker.record({ method, source, baseTarget, observedTarget })
        if (isDiff) proxyDebug('pipeline shadow target diff:', baseTarget, '->', observedTarget)
        const stats = ctx.shadowCompareTracker.getStats()
        if (stats.total >= ctx.SHADOW_WARN_MIN_SAMPLES &&
            stats.diffRate >= ctx.SHADOW_WARN_DIFF_RATE &&
            stats.total % ctx.SHADOW_WARN_MIN_SAMPLES === 0) {
            console.warn('[shadow-compare] diff rate is high: total=%d diff=%d diffRate=%s threshold=%s',
                stats.total, stats.diff, stats.diffRate, ctx.SHADOW_WARN_DIFF_RATE)
        }
        if (stats.total > 0 && stats.total % 200 === 0) {
            proxyDebug('pipeline shadow compare stats total=%d diff=%d diffRate=%s', stats.total, stats.diff, stats.diffRate)
        }
    }

    function shouldApplyPipelineOnForSource(source: string): boolean {
        return ctx.pipelineGate.shouldApplyPipelineOnForSource(source)
    }

    function canUsePipelineExecuteForSource(source: string): boolean {
        return ctx.pipelineGate.canUsePipelineExecuteForSource(source)
    }

    function shouldUsePluginMockForRequest(source: string, rule: any): boolean {
        return ctx.pipelineGate.shouldUsePluginMockForRequest(source, rule)
    }

    return {
        shouldInterceptResponse,
        interceptResponseWithPlugins,
        emitLegacyResponseToPlugins,
        emitLegacyErrorToPlugins,
        observeShadowDecision,
        shouldApplyPipelineOnForSource,
        canUsePipelineExecuteForSource,
        shouldUsePluginMockForRequest,
    }
}

const http = require('http')
const { resolveTargetUrl } = require('./dist/helpers')
const { decideRoute } = require('./dist/core/route-decision')
const { sendShortResponse } = require('./dist/core/short-response')
const { safeBodyToString } = require('./dist/core/body-utils')
const { handleMapLocalRequest } = require('./dist/core/map-local')
const { handleLocalRequest } = require('./dist/core/static-server')
const { appendProxyRecord } = require('./dist/core/proxy-record')

function createHttpProxyHandler(ctx, mockHandler, pluginIntercept, options) {
    const { SSL_REJECT_UNAUTHORIZED, expressApp, serverContext, proxyServer } = options

    return function (req, res) {
        const [hostname, port] = req.headers.host.split(':')
        const serverPort = proxyServer.address().port

        if ((hostname === '127.0.0.1' || hostname === 'localhost') && parseInt(port) === serverPort) {
            handleLocalRequest(req, res, { expressApp, serverContext, ctx })
            return
        }

        // ===== HTTP proxy =====
        const source = req.url

        const mockRule = mockHandler.matchMockRule(source, req.method)
        if (mockRule && !pluginIntercept.shouldUsePluginMockForRequest(source, mockRule)) {
            return mockHandler.sendMockResponse(req, res, mockRule, { method: req.method, source, target: source })
        }

        const reqChunks = []
        req.on('data', chunk => reqChunks.push(chunk))
        req.on('end', async () => {
            const reqBody = Buffer.concat(reqChunks)
            const legacyResolvedTarget = resolveTargetUrl(source, ctx.ruleMap, ctx.excludeMap)
            if (legacyResolvedTarget && legacyResolvedTarget.startsWith('file://')) {
                return handleMapLocalRequest(ctx, req, res, source, legacyResolvedTarget)
            }
            const legacyTarget = legacyResolvedTarget || source
            const routeDecision = await decideRoute({
                source, method: req.method, headers: req.headers, reqBody,
                legacyTarget, requestPipeline: ctx.requestPipeline,
                canUsePipelineExecuteForSource: pluginIntercept.canUsePipelineExecuteForSource,
                observeShadowDecision: pluginIntercept.observeShadowDecision,
                fallbackResolve: async () => ({ target: legacyTarget, shortCircuited: false, response: null }),
            })
            let target = routeDecision.target
            if (routeDecision.shortCircuited) { sendShortResponse(res, routeDecision.response); return }

            const url = new URL(target.startsWith('http') ? target : req.url, 'http://' + req.headers.host)
            const routeChanged = source !== url.href
            const startTime = Date.now()
            const intercepting = pluginIntercept.shouldInterceptResponse()

            const proxyReq = http.request(url, { method: req.method, headers: req.headers }, (proxyRes) => {
                const resChunks = []
                if (routeChanged) proxyRes.headers['x-real-url'] = url.href
                if (!intercepting) res.writeHead(proxyRes.statusCode, proxyRes.headers)
                proxyRes.on('data', chunk => { resChunks.push(chunk); if (!intercepting) res.write(chunk) })
                proxyRes.on('end', async () => {
                    const resBody = Buffer.concat(resChunks)
                    let intercepted = false
                    if (intercepting) {
                        try {
                            intercepted = await pluginIntercept.interceptResponseWithPlugins({
                                req, res, source, target: url.href, startTime,
                                statusCode: proxyRes.statusCode, headers: proxyRes.headers,
                                bodyBuffer: resBody, reqBody, inspectionMeta: routeDecision.meta,
                            })
                        } catch (e) { console.error('[plugin] intercept error:', e) }
                        if (!intercepted) { res.writeHead(proxyRes.statusCode, proxyRes.headers); res.end(resBody) }
                    } else { res.end() }

                    const recordId = ctx.recordIdSeq++
                    const logData = {
                        id: recordId, method: req.method, source, target: url.href,
                        time: new Date().toLocaleTimeString(), statusCode: proxyRes.statusCode,
                        duration: Date.now() - startTime
                    }
                    if (!intercepting) pluginIntercept.emitLegacyResponseToPlugins(logData)
                    const responseEncoding = proxyRes.headers && proxyRes.headers['content-encoding']
                    // 获取 inspection 信息
                    const inspectionStages = routeDecision.meta?._inspectionStages || []
                    const detail = {
                        requestHeaders: req.headers,
                        requestBody: safeBodyToString(reqBody, ctx.MAX_BODY_SIZE),
                        responseHeaders: proxyRes.headers,
                        responseBody: safeBodyToString(resBody, ctx.MAX_BODY_SIZE, responseEncoding),
                        statusCode: proxyRes.statusCode, statusMessage: proxyRes.statusMessage,
                        method: req.method, url: source,
                        inspection: inspectionStages.length > 0 ? {
                            url: source,
                            method: req.method,
                            stages: inspectionStages,
                            totalDuration: inspectionStages.reduce(function(sum, s) { return sum + s.duration }, 0),
                        } : undefined,
                    }
                    appendProxyRecord(ctx, logData, detail)
                })
            })
            proxyReq.on('error', (err) => {
                pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                console.error('HTTP proxy error:', err.message)
                if (!res.headersSent) res.writeHead(502)
                res.end()
            })
            proxyReq.write(reqBody)
            proxyReq.end()
        })
    }
}

module.exports = { createHttpProxyHandler }

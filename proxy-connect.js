const http2 = require('http2')
const { connect } = require('net')
const { WebSocket, WebSocketServer } = require('ws')
const { resolveTargetUrl, getFreePort } = require('./dist/helpers')
const { crtMgr } = require('./dist/cert')
const { decideRoute } = require('./dist/core/route-decision')
const { sendShortResponse } = require('./dist/core/short-response')
const { safeBodyToString } = require('./dist/core/body-utils')
const { makeProxyRequest, cleanHeadersForH2 } = require('./dist/core/h2-pool')
const { handleMapLocalRequest } = require('./dist/core/map-local')
const { appendProxyRecord } = require('./dist/core/proxy-record')
const _debug = require('debug')

const proxyDebug = _debug('proxy')

function createConnectHandler(ctx, mockHandler, pluginIntercept, options) {
    const { SSL_REJECT_UNAUTHORIZED } = options

    return async (req, socket, header) => {
        const originHost = req.url.split(':')[0]
        const needDecrypt = !!resolveTargetUrl('https://' + req.url + '/', ctx.ruleMap, ctx.excludeMap)
        proxyDebug('received connect request....', needDecrypt ? '(decrypt)' : '(tunnel)')

        socket.on('end', () => {})
        socket.on('error', (err) => { console.error(err) })

        // 无规则：直接隧道转发
        if (!needDecrypt) {
            const parts = req.url.split(':')
            const host = parts[0]
            const port = parts[1] ? parseInt(parts[1], 10) : 443
            const connection = connect({ host, port }, () => {
                socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                socket.pipe(connection)
                connection.pipe(socket)
            })
            connection.on('error', (err) => {
                proxyDebug('tunnel connect error', host + ':' + port, err.message)
                if (!socket.destroyed) {
                    try { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch (_) {}
                }
            })
            return
        }

        // 有规则：MITM 解密
        socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Node.js-Proxy\r\n\r\n')

        function createHttpsServerByCert() {
            return new Promise((resolve, reject) => {
                crtMgr.getCertificate(originHost, (error, key, crt) => {
                    if (error) return reject(error)
                    const server = http2.createSecureServer({ cert: crt, key, allowHTTP1: true }, (req, res) => {
                        const source = 'https://' + (req.headers.host || req.authority || originHost) + req.url

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

                            const routeChanged = source !== target
                            const startTime = Date.now()
                            const intercepting = pluginIntercept.shouldInterceptResponse()
                            try {
                                const proxyRes = await makeProxyRequest(target, req.method, req.headers, reqBody)
                                const resChunks = []
                                if (routeChanged) proxyRes.headers['x-real-url'] = target
                                if (!intercepting) res.writeHead(proxyRes.statusCode, cleanHeadersForH2(proxyRes.headers))

                                proxyRes.stream.on('data', chunk => { resChunks.push(chunk); if (!intercepting) res.write(chunk) })
                                proxyRes.stream.on('end', async () => {
                                    const resBody = Buffer.concat(resChunks)
                                    let intercepted = false
                                    if (intercepting) {
                                        try {
                                            intercepted = await pluginIntercept.interceptResponseWithPlugins({
                                                req, res, source, target, startTime,
                                                statusCode: proxyRes.statusCode, headers: proxyRes.headers,
                                                bodyBuffer: resBody, reqBody, inspectionMeta: routeDecision.meta, cleanHeaders: cleanHeadersForH2,
                                            })
                                        } catch (e) { console.error('[plugin] intercept error (HTTPS):', e) }
                                        if (!intercepted) { res.writeHead(proxyRes.statusCode, cleanHeadersForH2(proxyRes.headers)); res.end(resBody) }
                                    } else { res.end() }

                                    const recordId = ctx.recordIdSeq++
                                    const logData = {
                                        id: recordId, method: req.method, source, target,
                                        time: new Date().toLocaleTimeString(), protocol: proxyRes.protocol,
                                        statusCode: proxyRes.statusCode, duration: Date.now() - startTime
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
                            } catch (err) {
                                const code = err.code || ''
                                const isConnReset = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED'
                                if (isConnReset) {
                                    console.error('[proxy] upstream %s %s: %s', originHost + req.url, code, err.message)
                                } else {
                                    console.error('[error debug]', originHost + req.url, err)
                                }
                                pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                                if (!res.headersSent) { try { res.writeHead(502) } catch (_) {} }
                                try { res.end() } catch (_) {}
                            }
                        })
                    })

                    // WebSocket 代理（MITM HTTPS 服务器）- 使用 noServer 模式，统一在此处理并强制上游→客户端为文本
                    const wss = new WebSocketServer({ noServer: true })
                    server.on('upgrade', (req, socket, head) => {
                        if (socket._wsUpgradeHandled) return
                        socket._wsUpgradeHandled = true
                        wss.handleUpgrade(req, socket, head, (ws) => {
                            const source = 'wss://' + (req.headers.host || originHost) + req.url
                            let targetUrl = resolveTargetUrl(source, ctx.ruleMap, ctx.excludeMap)
                            if (!targetUrl) targetUrl = source

                            const outHeaders = { ...req.headers }
                            try {
                                const u = new URL(targetUrl)
                                outHeaders.host = u.host
                                if (!outHeaders.origin) outHeaders.origin = u.origin
                            } catch (_) {}

                            const proxyWs = new WebSocket(targetUrl, ws.protocol || [], {
                                rejectUnauthorized: SSL_REJECT_UNAUTHORIZED,
                                headers: outHeaders
                            })
                            const OPEN = 1
                            let closed = false
                            const safeClose = (sock, code, reason) => {
                                if (closed) return
                                try {
                                    if (sock.readyState === OPEN || sock.readyState === 0) sock.close(code, reason)
                                } catch (_) {}
                            }
                            const safeSend = (sock, data, label, isBinary) => {
                                if (sock.readyState !== OPEN) return
                                try {
                                    const cb = (err) => {
                                        if (err && err.message !== 'WebSocket is not open') proxyDebug(`[ws] ${label} send error: ${err.message}`)
                                    }
                                    if (typeof isBinary === 'boolean') {
                                        sock.send(data, { binary: isBinary }, cb)
                                    } else {
                                        sock.send(data, cb)
                                    }
                                } catch (e) {
                                    if (e.message !== 'WebSocket is not open') proxyDebug(`[ws] ${label} send: ${e.message}`)
                                }
                            }
                            const clientBuffer = []
                            const flushClientBuffer = () => {
                                while (clientBuffer.length) {
                                    const item = clientBuffer.shift()
                                    safeSend(proxyWs, item.data, 'upstream', item.isBinary)
                                }
                            }
                            ws.on('message', (data, isBinary) => {
                                const type = isBinary ? 'binary' : (typeof data === 'string' ? 'text' : 'unknown')
                                let preview = ''
                                if (typeof data === 'string') {
                                    try { preview = JSON.parse(data) ? '(valid json)' : '(text)' } catch { preview = '(text)' }
                                } else if (Buffer.isBuffer(data)) {
                                    preview = `(buffer ${data.length} bytes)`
                                }
                                proxyDebug(`[ws] client -> upstream: ${type} ${preview}`)
                                if (proxyWs.readyState === OPEN) {
                                    safeSend(proxyWs, data, 'upstream', isBinary)
                                } else if (proxyWs.readyState === 0) {
                                    clientBuffer.push({ data, isBinary })
                                }
                            })
                            proxyWs.on('open', () => {
                                flushClientBuffer()
                                proxyWs.on('message', (data, isBinary) => {
                                    const type = isBinary ? 'binary' : (typeof data === 'string' ? 'text' : 'unknown')
                                    let preview = ''
                                    if (typeof data === 'string') {
                                        try { preview = JSON.parse(data) ? '(valid json)' : '(text)' } catch { preview = '(text)' }
                                    } else if (Buffer.isBuffer(data)) {
                                        preview = `(buffer ${data.length} bytes)`
                                    }
                                    proxyDebug(`[ws] upstream -> client: ${type} ${preview}`)
                                    safeSend(ws, data, 'client', isBinary)
                                })
                            })
                            proxyWs.on('error', (e) => {
                                proxyDebug(`[ws] upstream ${targetUrl} error: ${e.message}`)
                                closed = true
                                safeClose(ws, 1011, 'upstream error')
                            })
                            proxyWs.on('close', (code, reason) => {
                                closed = true
                                safeClose(ws, code, reason)
                            })
                            ws.on('error', (e) => { proxyDebug(`[ws] client error: ${e.message}`) })
                            ws.on('close', (code, reason) => {
                                _debug('log')('ws close', code, reason)
                                closed = true
                                safeClose(proxyWs, code, reason)
                            })
                        })
                    })

                    resolve(server)
                })
            })
        }

        let server = ctx.httpsServerMap.get(originHost)
        if (!server) {
            const port = await getFreePort()
            server = await createHttpsServerByCert()
            server.listen(port, () => { proxyDebug('listening on ' + port) })
            ctx.httpsServerMap.set(originHost, server)
        }

        if (server.listening) {
            connectToLocalHttpsServer(server)
        } else {
            server.on('listening', () => { connectToLocalHttpsServer(server) })
        }

        function connectToLocalHttpsServer(server) {
            const connection = connect({
                host: server.address().address,
                port: server.address().port,
            }, () => {
                socket.pipe(connection)
                connection.pipe(socket)
            })
        }
    }
}

module.exports = { createConnectHandler }

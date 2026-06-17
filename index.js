const http = require('http')
const http2 = require('http2')
const fs = require('fs')
const path = require('path')
const { connect } = require('net')
const { WebSocket, WebSocketServer } = require('ws')
const { resolveTargetUrl, getFreePort } = require('./dist/helpers')
const { crtMgr, ensureRootCA, getRootCAPath } = require('./dist/cert')
const { decideRoute } = require('./dist/core/route-decision')
const { sendShortResponse } = require('./dist/core/short-response')
const { safeBodyToString } = require('./dist/core/body-utils')
const {
    establishConnectTunnel,
    isExpectedSocketError,
} = require('./dist/core/connect-tunnel')
const {
    createClientIdentityResolver,
    createMitmClientIdentityRegistry,
    getRequestClientIdentity,
    pluginClientIdentity,
} = require('./dist/core/client-identity')
const {
    authorizeProxyClient,
    buildRemoteAccessConfig,
    buildRemoteSetupHtml,
    createRemoteAccessInfo,
    getLanIPv4Addresses,
    isLoopbackAddress,
    isProxyHost,
    parseConnectAuthority,
    stripProxyHeaders,
} = require('./dist/core/remote-access')
const chalk = require('chalk')
const _debug = require('debug')

const proxyDebug = _debug('proxy')
const UPSTREAM_REQUEST_TIMEOUT_MS = 60000
const MITM_SERVER_IDLE_TTL_MS = 10 * 60 * 1000
const MITM_SERVER_SWEEP_INTERVAL_MS = 60 * 1000
const MAX_WS_BUFFERED_MESSAGES = 1000

function getErrorMessage(err) {
    return err && err.message ? err.message : String(err)
}

function getErrorKey(err) {
    return err && err.code ? err.code : getErrorMessage(err)
}

function finishResponseWithProxyError(res, statusCode = 502) {
    try {
        if (res.destroyed || res.writableEnded) return
        if (!res.headersSent) {
            res.writeHead(statusCode)
            res.end()
            return
        }
        if (typeof res.destroy === 'function') {
            res.destroy()
        } else {
            res.end()
        }
    } catch (_) {}
}

function markMitmServerUsed(server) {
    server._epLastUsedAt = Date.now()
}

function closeIdleMitmServer(originHost, server) {
    if (ctx.httpsServerMap.get(originHost) !== server) return

    ctx.httpsServerMap.delete(originHost)
    try { server._epWSServer?.close() } catch (_) {}
    try {
        server.close((err) => {
            if (err) proxyDebug('MITM server close error', originHost, err.message)
        })
    } catch (err) {
        proxyDebug('MITM server close failed', originHost, getErrorMessage(err))
    }
}

function sweepIdleMitmServers() {
    const now = Date.now()
    for (const [originHost, server] of ctx.httpsServerMap.entries()) {
        const lastUsedAt = server._epLastUsedAt || now
        const activeSockets = server._epActiveSockets?.size || 0
        if (activeSockets === 0 && now - lastUsedAt >= MITM_SERVER_IDLE_TTL_MS) {
            closeIdleMitmServer(originHost, server)
        }
    }
}

// ===== 共享上下文 =====
const { createProxyContext } = require('./dist/core/proxy-context')
const ctx = createProxyContext()
const mitmServerSweepTimer = setInterval(sweepIdleMitmServers, MITM_SERVER_SWEEP_INTERVAL_MS)
mitmServerSweepTimer.unref?.()

// ===== 模块初始化 =====
const { cleanHeadersForH2, makeProxyRequest } = require('./dist/core/h2-pool')
const { createMockHandler } = require('./dist/core/mock-handler')
const { handleMapLocalRequest } = require('./dist/core/map-local')
const { createRouteLoader } = require('./dist/core/route-loader')
const { createPluginIntercept } = require('./dist/core/plugin-intercept')
const { createPluginBootstrapRunner } = require('./dist/core/plugin-bootstrap-runner')
const { openBrowserWithProxy } = require('./dist/core/browser')
const { handleLocalRequest } = require('./dist/core/static-server')
const { createConfigDiagnostics } = require('./dist/core/config-diagnostics')
const { appendProxyRecord } = require('./dist/core/proxy-record')
const { createRuntimeHealthMonitor, parseWatchdogConfig } = require('./dist/core/runtime-health')
const { createRateLimitedLogger } = require('./dist/core/log-rate-limit')

const remoteAccess = buildRemoteAccessConfig()
const lanAddresses = getLanIPv4Addresses()
const clientIdentityResolver = createClientIdentityResolver(ctx.settingsPath)
const activeProxySockets = new Set()
const rateLimitedLogger = createRateLimitedLogger(console, {
    windowMs: Number(process.env.EP_LOG_RATE_LIMIT_WINDOW_MS) || 60000,
    maxPerWindow: Number(process.env.EP_LOG_RATE_LIMIT_MAX) || 20,
})

const mockHandler = createMockHandler(ctx)
const pluginIntercept = createPluginIntercept(ctx)
const pluginBoot = createPluginBootstrapRunner(ctx, mockHandler)
const runtimeHealth = createRuntimeHealthMonitor({
    getSnapshotInput: () => {
        const mitmServers = Array.from(ctx.httpsServerMap.entries()).map(([host, server]) => {
            const address = server.address && server.address()
            const port = address && typeof address === 'object' ? address.port : null
            const activeSockets = server._epActiveSockets?.size || 0
            const webSockets = server._epWSServer?.clients?.size || 0
            const lastUsedAt = server._epLastUsedAt || null

            return {
                host,
                port,
                activeSockets,
                webSockets,
                lastUsedAt,
                idleForMs: lastUsedAt ? Date.now() - lastUsedAt : null,
            }
        })
        const mitmTlsSockets = mitmServers.reduce((sum, item) => sum + item.activeSockets, 0)
        const webSockets = (ctx.localWSServer?.clients?.size || 0)
            + mitmServers.reduce((sum, item) => sum + item.webSockets, 0)
        const connections = {
            proxySockets: activeProxySockets.size,
            mitmTlsSockets,
            webSockets,
            total: activeProxySockets.size + mitmTlsSockets + webSockets,
        }

        return {
            connections,
            mitmServers,
            logRateLimit: rateLimitedLogger.getStats(),
        }
    },
    config: parseWatchdogConfig(process.env),
})

function logRuntimeError(key, ...args) {
    rateLimitedLogger.error(key, ...args)
}

function startRuntimeWatchdog() {
    if (!runtimeHealth.config.enabled) return

    const timer = setInterval(() => {
        const evaluation = runtimeHealth.evaluate()
        if (!evaluation.shouldWarn) return

        const message = `watchdog ${evaluation.status}: ${evaluation.reasons.join('; ')} (${evaluation.consecutiveFailures}/${runtimeHealth.config.failureThreshold})`
        rateLimitedLogger.warn('watchdog:runtime-health', message)
        if (evaluation.shouldExit) {
            handleFatalError('watchdog', new Error(message))
        }
    }, runtimeHealth.config.intervalMs)
    timer.unref?.()
}

// ===== Express API 服务 =====
const { createApp } = require('./dist/server/index')

let configDiag = null

const serverContext = {
    currentMocksPath: ctx.currentMocksPath,
    routeRules: ctx.routeRules,
    ruleMap: ctx.ruleMap,
    excludeMap: ctx.excludeMap,
    excludeMap: ctx.excludeMap,
    proxyRecordArr: ctx.proxyRecordArr,
    proxyRecordDetailMap: ctx.proxyRecordDetailMap,
    recordIdSeq: ctx.recordIdSeq,
    mockRules: ctx.mockRules,
    mockIdSeq: ctx.mockIdSeq,
    requestPipeline: ctx.requestPipeline,
    builtinLoggerPlugin: ctx.builtinLoggerPlugin,
    shadowCompareTracker: ctx.shadowCompareTracker,
    onModeGate: ctx.onModeGate,
    pluginManager: ctx.pluginManager,
    hookDispatcher: ctx.hookDispatcher,
    settingsPath: ctx.settingsPath,
    epDir: ctx.epDir,
    settings: null,
    loadMockRules: () => {
        mockHandler.loadMockRules()
        serverContext.mockRules = ctx.mockRules
        serverContext.mockIdSeq = ctx.mockIdSeq
    },
    saveMockRules: () => mockHandler.saveMockRules(),
    reloadCustomPlugins: () => pluginBoot.reloadCustomPlugins(),
    logRuleMap: () => routeLoader.logRuleMap(),
    reloadAllRuleFiles: () => routeLoader.reloadAllRuleFiles(),
    broadcastToAllClients: (data) => {
        if (ctx.localWSServer) {
            ctx.localWSServer.clients.forEach(client => {
                if (client.readyState === 1) client.send(JSON.stringify(data))
            })
        }
    },
    appendProxyRecordFromPluginTest: (logData, detail) => {
        const recordId = ctx.recordIdSeq++
        const entry = { id: recordId, ...pluginClientIdentity(), ...logData }
        appendProxyRecord(ctx, entry, detail)
    },
    getMockFilePath: () => mockHandler.getMockFilePath(),
    performConfigDiagnostics: () => configDiag && configDiag.performConfigDiagnostics(),
    loadSettingsSync: () => configDiag && configDiag.loadSettingsSync(),
    refreshClientAliases: () => clientIdentityResolver.refresh(),
    resolveTargetUrlForTest: (url) => resolveTargetUrl(url, ctx.routeRules) || url,
    canUsePipelineExecuteForTest: (source) => pluginIntercept.canUsePipelineExecuteForSource(source),
    matchMockRuleForTest: (url, method) => mockHandler.matchMockRule(url, method),
    shouldUseMockForTest: (source, rule) => !pluginIntercept.shouldUsePluginMockForRequest(source, rule),
    buildMockResponseForTest: (rule) => mockHandler.buildMockResponseForTest(rule),
    getRemoteAccessInfo: () => {
        const address = proxyServer.address()
        const port = address && typeof address === 'object' ? address.port : null
        return createRemoteAccessInfo(remoteAccess, lanAddresses, port)
    },
    getRuntimeHealth: () => runtimeHealth.snapshot(),
}

configDiag = createConfigDiagnostics(ctx, serverContext, mockHandler)

const routeLoader = createRouteLoader(ctx, serverContext)
const expressApp = createApp(serverContext)

// ===== 加载 Mock 和路由规则 =====
serverContext.loadMockRules()
routeLoader.initRouteRules()

// ===== Cross-Origin 插件 =====
const plugins = [{
    name: 'Plugin:Cross-Origin',
    beforeSendResponse(res) { res.setHeader('Access-Control-Allow-Origin', '*') }
}]

// ===== HTTP 代理服务器 =====
const proxyServer = http.createServer((req, res) => {
    const serverPort = proxyServer.address().port
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const requestTargetsProxy = isProxyHost(req.headers.host, serverPort, lanAddresses)

    if (requestTargetsProxy) {
        if (requestUrl.pathname === '/_easy-proxy/ca.crt') {
            const rootCAPath = getRootCAPath()
            res.writeHead(200, {
                'Content-Type': 'application/x-x509-ca-cert',
                'Content-Disposition': 'attachment; filename="easy-proxy-ca.crt"',
                'Cache-Control': 'no-store',
            })
            const certStream = fs.createReadStream(rootCAPath)
            certStream.on('error', (err) => {
                logRuntimeError('stream:ca-cert', 'CA certificate stream error:', getErrorMessage(err))
                finishResponseWithProxyError(res, 500)
            })
            certStream.pipe(res)
            return
        }

        if (remoteAccess.enabled && requestUrl.pathname === '/_easy-proxy/setup') {
            const requestedHost = requestUrl.hostname.replace(/^\[|\]$/g, '')
            const setupHost = requestedHost === 'localhost' || isLoopbackAddress(requestedHost)
                ? (lanAddresses[0] || requestedHost)
                : requestedHost
            const html = buildRemoteSetupHtml(
                setupHost,
                serverPort,
                remoteAccess.interceptHttps,
                !!remoteAccess.token,
            )
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            })
            res.end(html)
            return
        }

        if (isLoopbackAddress(req.socket.remoteAddress)) {
            handleLocalRequest(req, res, { expressApp, serverContext, ctx })
            return
        }

        if (remoteAccess.enabled && requestUrl.pathname === '/') {
            const html = buildRemoteSetupHtml(
                requestUrl.hostname,
                serverPort,
                remoteAccess.interceptHttps,
                !!remoteAccess.token,
            )
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            })
            res.end(html)
            return
        }

        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Remote access to the Easy Proxy management interface is forbidden')
        return
    }

    const access = authorizeProxyClient(req.socket.remoteAddress, req.headers, remoteAccess)
    if (!access.allowed) {
        const headers = { 'Content-Type': 'text/plain; charset=utf-8' }
        if (access.statusCode === 407) headers['Proxy-Authenticate'] = 'Basic realm="Easy Proxy"'
        res.writeHead(access.statusCode, headers)
        res.end(access.message)
        return
    }

    const clientIdentity = clientIdentityResolver.resolve(req.socket.remoteAddress)
    req._epClientIdentity = clientIdentity
    req.socket._epClientIdentity = clientIdentity

    // ===== HTTP 代理 =====
    const source = req.url

    const mockRule = mockHandler.matchMockRule(source, req.method)
    if (mockRule && !pluginIntercept.shouldUsePluginMockForRequest(source, mockRule)) {
        return mockHandler.sendMockResponse(req, res, mockRule, { method: req.method, source, target: source })
    }

    const reqChunks = []
    req.on('data', chunk => reqChunks.push(chunk))
    req.on('error', (err) => {
        logRuntimeError(`http:client-request:${getErrorKey(err)}`, 'HTTP client request error:', getErrorMessage(err))
        finishResponseWithProxyError(res, 400)
    })
    req.on('end', async () => {
        try {
        const reqBody = Buffer.concat(reqChunks)
        const legacyResolvedTarget = resolveTargetUrl(source, ctx.routeRules)
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

        const proxyReq = http.request(url, { method: req.method, headers: stripProxyHeaders(req.headers) }, (proxyRes) => {
            const resChunks = []
            let proxyResponseSettled = false
            const handleProxyResponseError = (err) => {
                if (proxyResponseSettled) return
                proxyResponseSettled = true
                pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                logRuntimeError(`http:proxy-response:${getErrorKey(err)}`, 'HTTP proxy response error:', getErrorMessage(err))
                finishResponseWithProxyError(res)
            }
            if (routeChanged) proxyRes.headers['x-real-url'] = url.href
            if (!intercepting) res.writeHead(proxyRes.statusCode, proxyRes.headers)
            proxyRes.on('data', chunk => { resChunks.push(chunk); if (!intercepting) res.write(chunk) })
            proxyRes.on('error', handleProxyResponseError)
            proxyRes.on('aborted', () => handleProxyResponseError(new Error('HTTP proxy response aborted')))
            proxyRes.on('close', () => {
                if (!proxyResponseSettled) handleProxyResponseError(new Error('HTTP proxy response closed before end'))
            })
            proxyRes.on('end', async () => {
                if (proxyResponseSettled) return
                proxyResponseSettled = true
                try {
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
                    duration: Date.now() - startTime,
                    ...clientIdentity,
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
                } catch (err) {
                    pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                    logRuntimeError(`http:response-handler:${getErrorKey(err)}`, 'HTTP proxy response handling error:', getErrorMessage(err))
                    finishResponseWithProxyError(res)
                }
            })
        })
        proxyReq.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
            proxyReq.destroy(new Error('HTTP upstream request timeout'))
        })
        proxyReq.on('error', (err) => {
            pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
            logRuntimeError(`http:proxy-request:${getErrorKey(err)}`, 'HTTP proxy error:', getErrorMessage(err))
            finishResponseWithProxyError(res)
        })
        proxyReq.write(reqBody)
        proxyReq.end()
        } catch (err) {
            pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
            logRuntimeError(`http:request-handler:${getErrorKey(err)}`, 'HTTP proxy request failed:', getErrorMessage(err))
            finishResponseWithProxyError(res)
        }
    })
})

proxyServer.on('connection', (socket) => {
    activeProxySockets.add(socket)
    socket.once('close', () => { activeProxySockets.delete(socket) })
})

// ===== WebSocket 服务（日志推送）=====
// 必须使用 noServer，避免与下方 proxyServer.on('upgrade') 重复 handleUpgrade
const localWSServer = new WebSocketServer({ noServer: true })
ctx.localWSServer = localWSServer

localWSServer.on('connection', (client, req) => {})

// ===== 启动 =====
;(async () => {
    await ensureRootCA()
    await pluginBoot.bootstrapBuiltinPlugins()
    const port = await getFreePort()
    proxyServer.listen(port, remoteAccess.bindHost, () => {
        const proxyUrl = `http://127.0.0.1:${port}`
        proxyDebug('proxy-server start on ' + chalk.green(proxyUrl))
        proxyDebug('plugin pipeline mode: ' + chalk.cyan(ctx.requestPipeline.mode))
        if (ctx.requestPipeline.mode === 'on') {
            proxyDebug('plugin on host allowlist: ' + (ctx.PLUGIN_ON_HOSTS.size > 0 ? Array.from(ctx.PLUGIN_ON_HOSTS).join(',') : '(all)'))
        }
        if (process.env.EP_MCP) {
            const mcpFile = path.join(ctx.epDir, 'mcp-proxy-url.json')
            const mcpData = { proxyUrl }
            if (process.env.EP_OPEN_CHROMEDEVTOOLS) mcpData.remoteDebuggingPort = 9222
            fs.writeFileSync(mcpFile, JSON.stringify(mcpData), 'utf8')
        }
        if (ctx.AUTO_OPEN) {
            const proxyAddr = `127.0.0.1:${port}`
            const remotePort = process.env.EP_OPEN_CHROMEDEVTOOLS ? 9222 : undefined
            if (openBrowserWithProxy(proxyUrl, proxyAddr, ctx.epDir, remotePort)) {
                console.log(chalk.green('已启动浏览器（代理:'), proxyAddr + chalk.green(')'))
            } else {
                console.log(chalk.yellow('浏览器并未启动，请手动打开'), chalk.cyan(proxyUrl), chalk.yellow('并设置代理'), proxyAddr)
            }
        }
        if (remoteAccess.enabled) {
            console.log(chalk.green('远程代理已启用，HTTPS 解密:'), remoteAccess.interceptHttps ? '开启' : '关闭')
            if (lanAddresses.length === 0) {
                console.log(chalk.yellow('未发现可用的局域网 IPv4 地址'))
            }
            for (const address of lanAddresses) {
                console.log(chalk.cyan(`手机配置入口: http://${address}:${port}/`))
                console.log(chalk.cyan(`代理服务器: ${address}:${port}`))
            }
            if (remoteAccess.token) {
                console.log(chalk.green('代理认证已启用，用户名: easy-proxy'))
            } else {
                console.log(chalk.yellow('代理认证未启用，请仅在可信局域网中使用'))
            }
        }
    })
})()

// ===== HTTPS CONNECT 处理 =====
proxyServer.on('connect', async (req, socket, head) => {
    socket.on('error', (err) => {
        if (!isExpectedSocketError(err)) proxyDebug('client CONNECT socket error', req.url, err.message)
    })

    const access = authorizeProxyClient(socket.remoteAddress, req.headers, remoteAccess)
    if (!access.allowed) {
        const authenticate = access.statusCode === 407
            ? 'Proxy-Authenticate: Basic realm="Easy Proxy"\r\n'
            : ''
        socket.end(`HTTP/1.1 ${access.statusCode} ${access.message}\r\n${authenticate}Connection: close\r\n\r\n`)
        return
    }

    const authority = parseConnectAuthority(req.url)
    if (!authority) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        return
    }
    const originHost = authority.host
    const clientIdentity = clientIdentityResolver.resolve(socket.remoteAddress)
    const needDecrypt = remoteAccess.interceptHttps
        || !!resolveTargetUrl(`https://${req.url}/`, ctx.routeRules)
    proxyDebug('received connect request....', needDecrypt ? '(decrypt)' : '(tunnel)')

    socket.on('end', () => {})

    // 无规则：直接隧道转发
    if (!needDecrypt) {
        const { host, port } = authority
        const connection = connect({ host, port }, () => {
            establishConnectTunnel(socket, connection, head)
        })
        connection.on('error', (err) => {
            if (!isExpectedSocketError(err)) {
                proxyDebug('tunnel connect error', host + ':' + port, err.message)
            }
            if (!socket.destroyed) {
                try { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch (_) {}
            }
        })
        return
    }

    function createHttpsServerByCert() {
        return new Promise((resolve, reject) => {
            crtMgr.getCertificate(originHost, (error, key, crt) => {
                if (error) return reject(error)
                const clientIdentityRegistry = createMitmClientIdentityRegistry()
                const server = http2.createSecureServer({ cert: crt, key, allowHTTP1: true }, (req, res) => {
                    const requestClientIdentity = getRequestClientIdentity(req)
                    const source = 'https://' + (req.headers.host || req.authority || originHost) + req.url

                    const mockRule = mockHandler.matchMockRule(source, req.method)
                    if (mockRule && !pluginIntercept.shouldUsePluginMockForRequest(source, mockRule)) {
                        return mockHandler.sendMockResponse(req, res, mockRule, { method: req.method, source, target: source })
                    }

                    const reqChunks = []
                    req.on('data', chunk => reqChunks.push(chunk))
                    req.on('error', (err) => {
                        logRuntimeError(`https:client-request:${getErrorKey(err)}`, 'HTTPS client request error:', getErrorMessage(err))
                        finishResponseWithProxyError(res, 400)
                    })
                    req.on('end', async () => {
                        try {
                        const reqBody = Buffer.concat(reqChunks)
                        const legacyResolvedTarget = resolveTargetUrl(source, ctx.routeRules)
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
                            const proxyRes = await makeProxyRequest(target, req.method, stripProxyHeaders(req.headers), reqBody)
                            const resChunks = []
                            let proxyResponseSettled = false
                            const handleProxyResponseError = (err) => {
                                if (proxyResponseSettled) return
                                proxyResponseSettled = true
                                pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                                logRuntimeError(`https:upstream-stream:${originHost}:${getErrorKey(err)}`, '[proxy] upstream stream %s: %s', originHost + req.url, getErrorMessage(err))
                                finishResponseWithProxyError(res)
                            }
                            if (routeChanged) proxyRes.headers['x-real-url'] = target
                            if (!intercepting) res.writeHead(proxyRes.statusCode, cleanHeadersForH2(proxyRes.headers))

                            proxyRes.stream.on('data', chunk => { resChunks.push(chunk); if (!intercepting) res.write(chunk) })
                            proxyRes.stream.on('error', handleProxyResponseError)
                            proxyRes.stream.on('aborted', () => handleProxyResponseError(new Error('upstream stream aborted')))
                            proxyRes.stream.on('close', () => {
                                if (!proxyResponseSettled) handleProxyResponseError(new Error('upstream stream closed before end'))
                            })
                            proxyRes.stream.on('end', async () => {
                                if (proxyResponseSettled) return
                                proxyResponseSettled = true
                                try {
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
                                    statusCode: proxyRes.statusCode, duration: Date.now() - startTime,
                                    ...requestClientIdentity,
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
                                } catch (err) {
                                    pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                                    logRuntimeError(`https:response-handler:${originHost}:${getErrorKey(err)}`, '[proxy] upstream response handling %s: %s', originHost + req.url, getErrorMessage(err))
                                    finishResponseWithProxyError(res)
                                }
                            })
                        } catch (err) {
                            const code = err.code || ''
                            const isConnReset = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED'
                            if (isConnReset) {
                                logRuntimeError(`https:upstream:${originHost}:${code}`, '[proxy] upstream %s %s: %s', originHost + req.url, code, err.message)
                            } else {
                                logRuntimeError(`https:upstream:${originHost}:${getErrorKey(err)}`, '[error debug]', originHost + req.url, err)
                            }
                            pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                            finishResponseWithProxyError(res)
                        }
                        } catch (err) {
                            pluginIntercept.emitLegacyErrorToPlugins('onBeforeResponse', err)
                            logRuntimeError(`https:request-handler:${originHost}:${getErrorKey(err)}`, '[proxy] HTTPS request handling %s: %s', originHost + req.url, getErrorMessage(err))
                            finishResponseWithProxyError(res)
                        }
                    })
                })
                markMitmServerUsed(server)
                server._epActiveSockets = new Set()

                server._epRegisterClientIdentity = (remotePort, identity) => {
                    clientIdentityRegistry.register(remotePort, identity)
                }
                server.on('secureConnection', tlsSocket => {
                    markMitmServerUsed(server)
                    server._epActiveSockets.add(tlsSocket)
                    tlsSocket.once('close', () => {
                        server._epActiveSockets.delete(tlsSocket)
                        markMitmServerUsed(server)
                    })
                    clientIdentityRegistry.attach(tlsSocket)
                })

                // WebSocket 代理（MITM HTTPS 服务器）- 使用 noServer 模式，统一在此处理并强制上游→客户端为文本
                const wss = new WebSocketServer({ noServer: true })
                server._epWSServer = wss
                server.on('upgrade', (req, socket, head) => {
                    markMitmServerUsed(server)
                    socket.on('error', (err) => {
                        if (err.code !== 'ECONNRESET') proxyDebug('[ws] mitm upgrade socket error:', err.message)
                    })
                    if (socket._wsUpgradeHandled) return
                    socket._wsUpgradeHandled = true
                    wss.handleUpgrade(req, socket, head, (ws) => {
                        const source = 'wss://' + (req.headers.host || originHost) + req.url
                        let targetUrl = resolveTargetUrl(source, ctx.routeRules)
                        if (!targetUrl) targetUrl = source

                        const outHeaders = { ...req.headers }
                        try {
                            const u = new URL(targetUrl)
                            outHeaders.host = u.host
                            if (!outHeaders.origin) outHeaders.origin = u.origin
                        } catch (_) {}

                        const proxyWs = new WebSocket(targetUrl, ws.protocol || [], {
                            rejectUnauthorized: false,
                            headers: outHeaders
                        })
                        const OPEN = 1
                        const CONNECTING = 0
                        let closed = false
                        const clientBuffer = []
                        const safeClose = (sock, code, reason) => {
                            try {
                                if (sock.readyState === OPEN || sock.readyState === CONNECTING) sock.close(code, reason)
                            } catch (_) {}
                        }
                        const closePeer = (sock, code, reason) => {
                            if (closed) return
                            closed = true
                            clientBuffer.length = 0
                            safeClose(sock, code, reason)
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
                            } else if (proxyWs.readyState === CONNECTING) {
                                if (clientBuffer.length >= MAX_WS_BUFFERED_MESSAGES) {
                                    closePeer(ws, 1011, 'upstream not ready')
                                    safeClose(proxyWs, 1011, 'upstream not ready')
                                    return
                                }
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
                            closePeer(ws, 1011, 'upstream error')
                        })
                        proxyWs.on('close', (code, reason) => {
                            closePeer(ws, code, reason)
                        })
                        ws.on('error', (e) => { proxyDebug(`[ws] client error: ${e.message}`) })
                        ws.on('close', (code, reason) => {
                            _debug('log')('ws close', code, reason)
                            closePeer(proxyWs, code, reason)
                        })
                    })
                })

                resolve(server)
            })
        })
    }

    try {
        let server = ctx.httpsServerMap.get(originHost)
        if (!server) {
            const port = await getFreePort()
            server = await createHttpsServerByCert()
            server.listen(port, '127.0.0.1', () => { proxyDebug('listening on ' + port) })
            ctx.httpsServerMap.set(originHost, server)
        } else {
            markMitmServerUsed(server)
        }

        if (server.listening) {
            connectToLocalHttpsServer(server)
        } else {
            server.once('listening', () => { connectToLocalHttpsServer(server) })
        }
    } catch (err) {
        proxyDebug('MITM setup error', originHost, err.message)
        if (!socket.destroyed) {
            try { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') } catch (_) {}
        }
    }

    function connectToLocalHttpsServer(server) {
        markMitmServerUsed(server)
        const connection = connect({
            host: '127.0.0.1',
            port: server.address().port,
        }, () => {
            server._epRegisterClientIdentity?.(connection.localPort, clientIdentity)
            establishConnectTunnel(socket, connection, head)
        })
        connection.on('error', (err) => {
            if (!isExpectedSocketError(err)) {
                proxyDebug('local MITM connection error', originHost, err.message)
            }
            if (!socket.destroyed) socket.destroy()
        })
    }
})

proxyServer.on('upgrade', (req, socket, head) => {
    socket.on('error', (err) => {
        if (err.code !== 'ECONNRESET') proxyDebug('[ws] upgrade socket error:', err.message)
    })

    if (isLoopbackAddress(socket.remoteAddress) && (req.url === '/ws' || req.url.startsWith('/ws?'))) {
        if (socket._epWsUpgradeHandled) return
        socket._epWsUpgradeHandled = true
        localWSServer.handleUpgrade(req, socket, head, (ws) => {
            localWSServer.emit('connection', ws, req)
        })
        return
    }

    socket.destroy()
})

let fatalErrorInProgress = false
const MAX_FATAL_LOG_CHARS = 20000

function formatFatalError(reason) {
    if (reason && reason.stack) return String(reason.stack)
    if (reason instanceof Error) return `${reason.name}: ${reason.message}`
    if (typeof reason === 'string') return reason

    try {
        return JSON.stringify(reason)
    } catch (_) {
        return String(reason)
    }
}

function writeFatalError(type, reason) {
    let message = `[fatal] ${type}\n${formatFatalError(reason)}\n`
    if (message.length > MAX_FATAL_LOG_CHARS) {
        message = message.slice(0, MAX_FATAL_LOG_CHARS) + '\n[fatal] stack truncated\n'
    }

    try {
        fs.writeSync(2, message)
    } catch (_) {
        // If stderr itself fails, exit anyway; the process is in an undefined state.
    }
}

function handleFatalError(type, reason) {
    if (!fatalErrorInProgress) {
        fatalErrorInProgress = true
        writeFatalError(type, reason)
    }

    process.exit(1)
}

process.on('uncaughtException', (err) => {
    handleFatalError('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
    handleFatalError('unhandledRejection', reason)
})

startRuntimeWatchdog()

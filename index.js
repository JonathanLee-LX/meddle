const http = require('http')
const { WebSocketServer } = require('ws')
const { createProxyContext } = require('./dist/core/proxy-context')
const { createMockHandler } = require('./dist/core/mock-handler')
const { createPluginIntercept } = require('./dist/core/plugin-intercept')
const { createPluginBootstrapRunner } = require('./dist/core/plugin-bootstrap-runner')
const { createConfigDiagnostics } = require('./dist/core/config-diagnostics')
const { createRouteLoader } = require('./dist/core/route-loader')
const { createApp } = require('./dist/server/index')
const { createHttpProxyHandler } = require('./proxy-handler')
const { createConnectHandler } = require('./proxy-connect')
const { startProxyServer, setupErrorHandler, SSL_REJECT_UNAUTHORIZED } = require('./proxy-bootstrap')

// Create shared context
const ctx = createProxyContext()

// Initialize modules
const mockHandler = createMockHandler(ctx)
const pluginIntercept = createPluginIntercept(ctx)
const pluginBoot = createPluginBootstrapRunner(ctx, mockHandler)

// Build server context bridge
const serverContext = {
    currentMocksPath: ctx.currentMocksPath,
    ruleMap: ctx.ruleMap,
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
    loadMockRules: () => mockHandler.loadMockRules(),
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
        const { appendProxyRecord } = require('./dist/core/proxy-record')
        const recordId = ctx.recordIdSeq++
        const entry = { id: recordId, ...logData }
        appendProxyRecord(ctx, entry, detail)
    },
    getMockFilePath: () => mockHandler.getMockFilePath(),
    performConfigDiagnostics: () => configDiag && configDiag.performConfigDiagnostics(),
    loadSettingsSync: () => configDiag && configDiag.loadSettingsSync(),
    resolveTargetUrlForTest: (url) => {
        const { resolveTargetUrl } = require('./dist/helpers')
        return resolveTargetUrl(url, ctx.ruleMap, ctx.excludeMap) || url
    },
    canUsePipelineExecuteForTest: (source) => pluginIntercept.canUsePipelineExecuteForSource(source),
    matchMockRuleForTest: (url, method) => mockHandler.matchMockRule(url, method),
    shouldUseMockForTest: (source, rule) => !pluginIntercept.shouldUsePluginMockForRequest(source, rule),
    buildMockResponseForTest: (rule) => mockHandler.buildMockResponseForTest(rule),
}

const configDiag = createConfigDiagnostics(ctx, serverContext, mockHandler)
const routeLoader = createRouteLoader(ctx, serverContext)
const expressApp = createApp(serverContext)

// Load rules
mockHandler.loadMockRules()
routeLoader.initRouteRules()

// Create proxy server with HTTP handler
const proxyServer = http.createServer()
proxyServer.on('request', createHttpProxyHandler(ctx, mockHandler, pluginIntercept, {
    SSL_REJECT_UNAUTHORIZED, expressApp, serverContext, proxyServer
}))

// WebSocket log server
const localWSServer = new WebSocketServer({ server: proxyServer })
ctx.localWSServer = localWSServer
localWSServer.addListener('connection', (client, req) => {})

// HTTPS CONNECT handler
proxyServer.on('connect', createConnectHandler(ctx, mockHandler, pluginIntercept, { SSL_REJECT_UNAUTHORIZED }))

// WebSocket upgrade handler
proxyServer.on('upgrade', (req, socket, header) => {
    if (req.url === '/ws' || req.url.startsWith('/ws?')) {
        localWSServer.handleUpgrade(req, socket, header)
    } else {
        socket.destroy()
    }
})

// Error handler
setupErrorHandler()

// Start
startProxyServer(proxyServer, ctx, pluginBoot)

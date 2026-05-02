import express, { Application } from 'express'

import { registerConfigRoutes } from './config'
import { registerPluginsRoutes } from './plugins'
import { registerRulesRoutes } from './rules'
import { registerLogsRoutes } from './logs'
import { registerMocksRoutes } from './mocks'
import { registerPipelineRoutes } from './pipeline'
import { registerRefactorRoutes } from './refactor'
import { registerRuleFilesRoutes } from './rule-files'
import { registerSystemRoutes, ServerContextWithSystem } from './system'
import { applySecurityMiddleware, SecurityConfig } from './security-middleware'

// RuleMap and ExcludeMap types from helpers
export type RuleMap = Record<string, string>;
export type ExcludeMap = Record<string, string[]>;

// Server context interface
export interface ServerContext {
    currentMocksPath: string | null
    ruleMap: RuleMap
    excludeMap: ExcludeMap
    proxyRecordArr: Array<{
        id?: number
        method: string
        source: string
        target: string
        time: string
        statusCode?: number
        duration?: number
    }>
    proxyRecordDetailMap: Map<number, {
        requestHeaders: Record<string, string>
        requestBody?: string
        responseHeaders: Record<string, string>
        responseBody?: string
        statusCode: number
        statusMessage?: string
        method: string
        url: string
    }>
    recordIdSeq: number
    mockRules: Array<{
        id: number
        name: string
        urlPattern: string
        method: string
        statusCode: number
        delay: number
        bodyType: string
        headers: Record<string, string>
        body: string
        enabled: boolean
    }>
    mockIdSeq: number
    requestPipeline: {
        mode: string
        setMode: (mode: string) => void
    }
    builtinLoggerPlugin: {
        getSummary?: () => unknown
        getRecentEntries?: () => unknown[]
    }
    shadowCompareTracker: {
        reset: () => void
        getStats: () => {
            total: number
            diff: number
            diffRate: string
        }
        record: (opts: { method: string; source: string; baseTarget: string; observedTarget: string }) => boolean
    }
    onModeGate: {
        reset: () => void
        getStats: () => unknown
        shouldAllow: (host: string) => boolean
        setMode: (mode: string) => void
    }
    pluginManager: {
        getAll: () => Array<{
            manifest: {
                id: string
                name: string
                version: string
                hooks?: string[]
                permissions?: string[]
                priority?: number
            }
            [key: string]: unknown
        }>
        getState: (id: string) => string
        setState: (id: string, state: string) => void
    }
    hookDispatcher: {
        getPluginStats?: () => Record<string, unknown>
    }
    settingsPath: string
    epDir: string
    settings: unknown
    loadMockRules: () => void
    saveMockRules: () => void
    reloadCustomPlugins: () => Promise<unknown[]>
    logRuleMap: () => void
    reloadAllRuleFiles: () => void
    broadcastToAllClients: (data: unknown) => void
    appendProxyRecordFromPluginTest: (
        logData: { method: string; source: string; target: string; time: string; statusCode?: number; duration?: number; _fromPluginTest?: boolean },
        detail?: { requestHeaders: Record<string, string>; requestBody?: string; responseHeaders: Record<string, string>; responseBody?: string; statusCode: number; statusMessage?: string; method: string; url: string }
    ) => void
    getMockFilePath: () => string
    performConfigDiagnostics: () => {
        status: string
        checks: Array<{ name: string; status: string; path?: string; details?: unknown }>
        errors: string[]
        warnings: string[]
    }
    loadSettingsSync: () => unknown
    /** 供插件测试：解析路由得到目标 URL */
    resolveTargetUrlForTest?: (url: string) => string
    /** 供插件测试：该请求是否会走 request pipeline */
    canUsePipelineExecuteForTest?: (source: string) => boolean
    /** 供插件测试：匹配 Mock 规则 */
    matchMockRuleForTest?: (url: string, method: string) => { statusCode?: number; headers?: Record<string, string>; body?: string; bodyType?: string; name?: string; id?: number; urlPattern?: string; enabled?: boolean } | null
    /** 供插件测试：是否应对该请求使用 Mock（而非走插件 Mock） */
    shouldUseMockForTest?: (source: string, rule: unknown) => boolean
    /** 供插件测试：根据 Mock 规则构建响应对象 */
    buildMockResponseForTest?: (rule: unknown) => { statusCode: number; headers: Record<string, string>; body: string }
}

/**
 * Create an Express app that handles all API routes
 * @param serverContext - The server context containing all state and helpers
 * @returns Express app as a handler function compatible with (req, res) signature
 */
export function createApp(serverContext: ServerContext, securityConfig?: SecurityConfig): Application {
    const app = express()

    // Apply security middleware first
    const { token } = applySecurityMiddleware(app, serverContext.epDir, securityConfig)

    // Store auth token in context for use by other modules
    ;(app as unknown as { authToken: string }).authToken = token

    // Middleware to parse JSON bodies
    app.use(express.json({ limit: '50mb' }))
    app.use(express.urlencoded({ extended: true, limit: '50mb' }))

    // Register all API routes
    registerConfigRoutes(app, serverContext)
    registerPluginsRoutes(app, serverContext)
    registerRulesRoutes(app, serverContext)
    registerLogsRoutes(app, serverContext)
    registerMocksRoutes(app, serverContext)
    registerPipelineRoutes(app, serverContext)
    registerRefactorRoutes(app, serverContext)
    registerRuleFilesRoutes(app, serverContext)
    registerSystemRoutes(app, serverContext as unknown as ServerContextWithSystem)

    // Health check endpoint (no auth required)
    app.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: Date.now() })
    })

    // Export helper references for backward compatibility
    ;(app as unknown as { serverContext: ServerContext }).serverContext = serverContext

    return app
}

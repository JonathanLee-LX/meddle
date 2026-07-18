import * as fs from 'fs'
import * as path from 'path'
import { createPipeline, normalizeMode } from './pipeline'
import { PluginManager, HookDispatcher } from './plugin-runtime'
import { createShadowCompareTracker } from './shadow-compare'
import { createOnModeGate, parseHostAllowlist } from './on-mode-gate'
import { createPipelineGate } from './pipeline-gate'
import { buildRefactorConfig } from './refactor-config'
import { createBuiltinLoggerPlugin } from '../plugins/builtin/logger-plugin'
import type { ProxyContext, PluginMode } from './types'
import { resolveEpHome } from './ep-home'

const epDir = resolveEpHome()
const certDir = path.resolve(epDir, 'ca')
if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true })
}
const settingsPath = path.resolve(epDir, 'settings.json')

const AUTO_OPEN = process.argv.includes('--open') || process.env.EP_OPEN === '1'
const REFACTOR_CONFIG = buildRefactorConfig(process.env, { normalizeMode, parseHostAllowlist })
;(global as any).REFACTOR_CONFIG = REFACTOR_CONFIG

function resolveInitialPluginMode(): PluginMode {
    if (process.env.EP_PLUGIN_MODE) return REFACTOR_CONFIG.pluginMode
    try {
        if (fs.existsSync(settingsPath)) {
            const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
            if (s.pluginMode && ['off', 'shadow', 'on'].includes(s.pluginMode)) return s.pluginMode
        }
    } catch (_) { /* ignore */ }
    return REFACTOR_CONFIG.pluginMode
}

const INITIAL_PLUGIN_MODE = resolveInitialPluginMode()
const MAX_RECORD_SIZE = process.env.MAX_RECORD_SIZE ? parseInt(process.env.MAX_RECORD_SIZE) : 10000
const MAX_DETAIL_SIZE = 200
const MAX_BODY_SIZE = 5 * 1024 * 1024

const pluginManager = new PluginManager({ logger: console })
const hookDispatcher = new HookDispatcher(pluginManager, { logger: console })
const requestPipeline = createPipeline({
    mode: INITIAL_PLUGIN_MODE,
    pluginManager,
    dispatcher: hookDispatcher,
    logger: console,
})

const builtinLoggerPlugin = createBuiltinLoggerPlugin({ maxEntries: MAX_RECORD_SIZE })
const shadowCompareTracker = createShadowCompareTracker({ maxSamples: 30 })
const onModeGate = createOnModeGate({
    mode: INITIAL_PLUGIN_MODE,
    allowlist: REFACTOR_CONFIG.pluginOnHosts,
})
const pipelineGate = createPipelineGate({
    requestPipeline,
    onModeGate,
    enableBuiltinMockPlugin: REFACTOR_CONFIG.enableBuiltinMock,
})

export function createProxyContext(): ProxyContext {
    return {
        epDir,
        certDir,
        settingsPath,
        AUTO_OPEN,
        REFACTOR_CONFIG,
        INITIAL_PLUGIN_MODE,
        MAX_RECORD_SIZE,
        MAX_DETAIL_SIZE,
        MAX_BODY_SIZE,
        SHADOW_WARN_MIN_SAMPLES: REFACTOR_CONFIG.shadowWarnMinSamples,
        SHADOW_WARN_DIFF_RATE: REFACTOR_CONFIG.shadowWarnDiffRate,
        PLUGIN_ON_HOSTS: REFACTOR_CONFIG.pluginOnHosts,
        ENABLE_BUILTIN_ROUTER_PLUGIN: REFACTOR_CONFIG.enableBuiltinRouter,
        ENABLE_BUILTIN_LOGGER_PLUGIN: REFACTOR_CONFIG.enableBuiltinLogger,
        ENABLE_BUILTIN_MOCK_PLUGIN: REFACTOR_CONFIG.enableBuiltinMock,

        pluginManager,
        hookDispatcher,
        requestPipeline,
        builtinLoggerPlugin,
        shadowCompareTracker,
        onModeGate,
        pipelineGate,

        routeRules: [],
        ruleMap: {},
        excludeMap: {},
        currentMocksPath: null,
        mockRules: [],
        mockIdSeq: 1,
        proxyRecordArr: [],
        recordIdSeq: 0,
        proxyRecordDetailMap: new Map(),
        httpsServerMap: new Map(),

        localWSServer: null,
    }
}

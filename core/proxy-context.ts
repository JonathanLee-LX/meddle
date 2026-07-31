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
import { resolveMeddleHome } from './meddle-home'

const meddleDir = resolveMeddleHome()
const certDir = path.resolve(meddleDir, 'ca')
if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true })
}
const settingsPath = path.resolve(meddleDir, 'settings.json')

const AUTO_OPEN = process.argv.includes('--open') || process.env.MEDDLE_OPEN === '1'
const REFACTOR_CONFIG = buildRefactorConfig(process.env, { normalizeMode, parseHostAllowlist })
;(global as any).REFACTOR_CONFIG = REFACTOR_CONFIG

function resolveInitialPluginMode(): PluginMode {
    if (process.env.MEDDLE_PLUGIN_MODE) return REFACTOR_CONFIG.pluginMode
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
const MAX_DETAIL_BODY_SIZE = (process.env.MEDDLE_MAX_DETAIL_BODY_KB ? parseInt(process.env.MEDDLE_MAX_DETAIL_BODY_KB) : 256) * 1024

// Resolve the effective detail body size limit (mtime-cached to avoid
// per-request file I/O on the hot proxy path). Precedence:
//   1. session settings.json  -> detailBodySizeKB
//   2. default session settings.json -> detailBodySizeKB (inherited only
//      by non-default sessions following the <defaultHome>/sessions/<id> layout)
//   3. env MEDDLE_MAX_DETAIL_BODY_KB (folded into fallbackBytes)
//   4. default 256KB (folded into fallbackBytes)
export function createDetailBodyLimitResolver(settingsPath: string, meddleDir: string, fallbackBytes: number): () => number {
    // Detect the "default session" home. Sessions live under
    // <defaultHome>/sessions/<id>, so the default home is two levels up — but
    // only when meddleDir actually follows this layout (basename(parent) ===
    // 'sessions'). A custom MEDDLE_HOME that is not a session is treated as
    // the default session itself (no inheritance).
    const parentDir = path.dirname(meddleDir)
    const isSession = path.basename(parentDir) === 'sessions'
    const defaultSettingsPath = isSession ? path.resolve(parentDir, '..', 'settings.json') : null
    const sameAsDefault = defaultSettingsPath === null || path.resolve(settingsPath) === defaultSettingsPath

    let cachedBytes = fallbackBytes
    let lastSessionMtime = -1
    let lastDefaultMtime = -1

    return function resolveDetailBodySizeBytes(): number {
        try {
            const sessionMtime = getFileMtime(settingsPath)
            const defaultMtime = sameAsDefault ? sessionMtime : getFileMtime(defaultSettingsPath as string)
            if (sessionMtime === lastSessionMtime && defaultMtime === lastDefaultMtime) {
                return cachedBytes
            }
            lastSessionMtime = sessionMtime
            lastDefaultMtime = defaultMtime

            const sessionKB = readDetailBodyKB(settingsPath)
            if (sessionKB !== null) {
                cachedBytes = sessionKB * 1024
                return cachedBytes
            }
            if (!sameAsDefault && defaultSettingsPath) {
                const defaultKB = readDetailBodyKB(defaultSettingsPath)
                if (defaultKB !== null) {
                    cachedBytes = defaultKB * 1024
                    return cachedBytes
                }
            }
            cachedBytes = fallbackBytes
            return cachedBytes
        } catch (_) {
            return fallbackBytes
        }
    }
}

function getFileMtime(filePath: string): number {
    try {
        if (!fs.existsSync(filePath)) return 0
        return fs.statSync(filePath).mtimeMs
    } catch (_) {
        return 0
    }
}

function readDetailBodyKB(filePath: string): number | null {
    try {
        if (!fs.existsSync(filePath)) return null
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { detailBodySizeKB?: unknown }
        const kb = settings.detailBodySizeKB
        return (typeof kb === 'number' && Number.isFinite(kb) && kb >= 1) ? Math.floor(kb) : null
    } catch (_) {
        return null
    }
}

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
        meddleDir,
        certDir,
        settingsPath,
        AUTO_OPEN,
        REFACTOR_CONFIG,
        INITIAL_PLUGIN_MODE,
        MAX_RECORD_SIZE,
        MAX_DETAIL_SIZE,
        MAX_BODY_SIZE,
        MAX_DETAIL_BODY_SIZE,
        resolveDetailBodySizeBytes: createDetailBodyLimitResolver(settingsPath, meddleDir, MAX_DETAIL_BODY_SIZE),
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

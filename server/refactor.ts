import { Application, Request, Response } from 'express'
import * as process from 'process'
import { ServerContext } from './index'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateShadowReadiness, buildReadinessAdvice } = require('../core/shadow-readiness')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildRefactorStatus } = require('../core/refactor-status')

export function registerRefactorRoutes(app: Application, ctx: ServerContext): void {
    // API: /api/refactor/status - Get comprehensive refactor/runtime status
    app.get('/api/refactor/status', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const shadowStats = ctx.shadowCompareTracker.getStats()
        const readiness = evaluateShadowReadiness(shadowStats, {
            minSamples: 10, // Should come from REFACTOR_CONFIG
            maxDiffRate: 0.1, // Should come from REFACTOR_CONFIG
        })
        const gateStats = ctx.onModeGate.getStats()
        const advice = buildReadinessAdvice({
            mode: ctx.requestPipeline.mode,
            readiness,
            allowlist: [], // Should come from REFACTOR_CONFIG
            onModeGate: gateStats as { mode: string; allowed: number; denied: number; total: number },
        })
        const pluginStats = ctx.hookDispatcher.getPluginStats ? ctx.hookDispatcher.getPluginStats() : {}
        const plugins = ctx.pluginManager.getAll().map((plugin) => ({
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            state: ctx.pluginManager.getState(plugin.manifest.id),
            stats: pluginStats[plugin.manifest.id] || null,
        }))
        const payload = buildRefactorStatus({
            runtime: {
                pid: process.pid,
                uptimeSec: Math.floor(process.uptime()),
            },
            mode: ctx.requestPipeline.mode,
            allowlist: [], // Should come from REFACTOR_CONFIG
            readiness,
            advice,
            shadowStats,
            onModeGate: gateStats as { mode: string; allowed: number; denied: number; total: number },
            plugins,
            loggerSummary: typeof ctx.builtinLoggerPlugin.getSummary === 'function'
                ? ctx.builtinLoggerPlugin.getSummary()
                : null,
        })
        res.write(JSON.stringify(payload))
        res.end()
    })
}

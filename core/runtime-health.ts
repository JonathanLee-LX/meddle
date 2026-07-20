import * as fs from 'fs'
import * as os from 'os'
import { monitorEventLoopDelay } from 'perf_hooks'

export interface RuntimeConnectionStats {
    proxySockets: number
    mitmTlsSockets: number
    webSockets: number
    total: number
}

export interface RuntimeMitmServerInfo {
    host: string
    port: number | null
    activeSockets: number
    webSockets: number
    lastUsedAt: number | null
    idleForMs: number | null
}

export interface RuntimeHealthSnapshotInput {
    connections: RuntimeConnectionStats
    mitmServers: RuntimeMitmServerInfo[]
    logRateLimit?: unknown
}

export interface WatchdogConfig {
    enabled: boolean
    action: 'exit' | 'warn'
    intervalMs: number
    minUptimeMs: number
    failureThreshold: number
    cpuPercent: number
    rssBytes: number
    connectionCount: number
    mitmServerCount: number
    fdCount: number
    eventLoopDelayMs: number
}

export interface RuntimeHealth {
    generatedAt: number
    status: 'ok' | 'degraded' | 'critical'
    pid: number
    uptimeSec: number
    platform: string
    memory: NodeJS.MemoryUsage
    cpu: {
        percent: number
        cores: number
        loadAverage: number[]
    }
    eventLoop: {
        meanMs: number
        maxMs: number
    }
    process: {
        fdCount: number | null
        activeHandles: number | null
        activeRequests: number | null
    }
    connections: RuntimeConnectionStats
    mitmServers: {
        count: number
        activeSockets: number
        items: RuntimeMitmServerInfo[]
    }
    logs: unknown
    watchdog: {
        config: WatchdogConfig
        consecutiveFailures: number
        lastReason: string | null
    }
    checks: Array<{
        name: string
        status: 'ok' | 'degraded' | 'critical'
        value: number
        limit: number
        unit: string
    }>
}

export interface WatchdogEvaluation {
    status: RuntimeHealth['status']
    shouldExit: boolean
    shouldWarn: boolean
    reasons: string[]
    consecutiveFailures: number
}

export function parseWatchdogConfig(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
    return {
        enabled: env.MEDDLE_WATCHDOG !== '0',
        action: env.MEDDLE_WATCHDOG_ACTION === 'warn' ? 'warn' : 'exit',
        intervalMs: parseIntEnv(env.MEDDLE_WATCHDOG_INTERVAL_MS, 30000, 1000),
        minUptimeMs: parseIntEnv(env.MEDDLE_WATCHDOG_MIN_UPTIME_MS, 30000, 0),
        failureThreshold: parseIntEnv(env.MEDDLE_WATCHDOG_FAILURES, 3, 1),
        cpuPercent: parseNumberEnv(env.MEDDLE_WATCHDOG_CPU_PERCENT, 95, 1),
        rssBytes: parseNumberEnv(env.MEDDLE_WATCHDOG_RSS_MB, 1536, 1) * 1024 * 1024,
        connectionCount: parseIntEnv(env.MEDDLE_WATCHDOG_CONNECTIONS, 1000, 1),
        mitmServerCount: parseIntEnv(env.MEDDLE_WATCHDOG_MITM_SERVERS, 100, 1),
        fdCount: parseIntEnv(env.MEDDLE_WATCHDOG_FDS, 2048, 1),
        eventLoopDelayMs: parseNumberEnv(env.MEDDLE_WATCHDOG_EVENT_LOOP_MS, 1000, 1),
    }
}

export function createRuntimeHealthMonitor(options: {
    startedAt?: number
    getSnapshotInput: () => RuntimeHealthSnapshotInput
    config?: WatchdogConfig
}) {
    const startedAt = options.startedAt || Date.now()
    const config = options.config || parseWatchdogConfig()
    const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
    eventLoopDelay.enable()
    let lastCpuUsage = process.cpuUsage()
    let lastCpuSampleAt = process.hrtime.bigint()
    let lastCpuPercent = 0
    let consecutiveFailures = 0
    let lastReason: string | null = null

    function sampleCpuPercent(): number {
        const usage = process.cpuUsage()
        const sampleAt = process.hrtime.bigint()
        const elapsedUs = Number(sampleAt - lastCpuSampleAt) / 1000
        const cpuUs = (usage.user - lastCpuUsage.user) + (usage.system - lastCpuUsage.system)

        lastCpuUsage = usage
        lastCpuSampleAt = sampleAt

        if (elapsedUs <= 0) return lastCpuPercent
        lastCpuPercent = Math.max(0, Number((cpuUs / elapsedUs * 100).toFixed(1)))
        return lastCpuPercent
    }

    function snapshot(): RuntimeHealth {
        const input = options.getSnapshotInput()
        const memory = process.memoryUsage()
        const cpuPercent = sampleCpuPercent()
        const fdCount = getFdCount()
        const activeHandles = getActiveCount('_getActiveHandles')
        const activeRequests = getActiveCount('_getActiveRequests')
        const eventLoopMeanMs = Number((eventLoopDelay.mean / 1e6 || 0).toFixed(1))
        const eventLoopMaxMs = Number((eventLoopDelay.max / 1e6 || 0).toFixed(1))
        eventLoopDelay.reset()

        const checks = [
            check('cpu', cpuPercent, config.cpuPercent, '%'),
            check('rss', memory.rss, config.rssBytes, 'bytes'),
            check('connections', input.connections.total, config.connectionCount, 'count'),
            check('mitmServers', input.mitmServers.length, config.mitmServerCount, 'count'),
            check('eventLoopDelay', eventLoopMaxMs, config.eventLoopDelayMs, 'ms'),
        ]
        if (fdCount !== null) checks.push(check('fds', fdCount, config.fdCount, 'count'))

        const status = checks.some(item => item.status === 'critical')
            ? 'critical'
            : checks.some(item => item.status === 'degraded')
                ? 'degraded'
                : 'ok'

        return {
            generatedAt: Date.now(),
            status,
            pid: process.pid,
            uptimeSec: Math.floor(process.uptime()),
            platform: process.platform,
            memory,
            cpu: {
                percent: cpuPercent,
                cores: os.cpus().length,
                loadAverage: os.loadavg(),
            },
            eventLoop: {
                meanMs: eventLoopMeanMs,
                maxMs: eventLoopMaxMs,
            },
            process: {
                fdCount,
                activeHandles,
                activeRequests,
            },
            connections: input.connections,
            mitmServers: {
                count: input.mitmServers.length,
                activeSockets: input.mitmServers.reduce((sum, item) => sum + item.activeSockets, 0),
                items: input.mitmServers,
            },
            logs: input.logRateLimit || null,
            watchdog: {
                config,
                consecutiveFailures,
                lastReason,
            },
            checks,
        }
    }

    function evaluate(): WatchdogEvaluation {
        const health = snapshot()
        const uptimeMs = Date.now() - startedAt
        const criticalChecks = health.checks.filter(item => item.status === 'critical')
        const active = config.enabled && uptimeMs >= config.minUptimeMs

        if (active && criticalChecks.length > 0) {
            consecutiveFailures += 1
            lastReason = criticalChecks.map(item => `${item.name}=${item.value}${item.unit} limit=${item.limit}${item.unit}`).join('; ')
        } else {
            consecutiveFailures = 0
            lastReason = null
        }

        const thresholdReached = consecutiveFailures >= config.failureThreshold
        return {
            status: health.status,
            shouldExit: active && thresholdReached && config.action === 'exit',
            shouldWarn: active && criticalChecks.length > 0,
            reasons: criticalChecks.map(item => `${item.name} ${item.value}${item.unit} >= ${item.limit}${item.unit}`),
            consecutiveFailures,
        }
    }

    function dispose(): void {
        eventLoopDelay.disable()
    }

    return { snapshot, evaluate, dispose, config }
}

function parseIntEnv(value: string | undefined, fallback: number, min: number): number {
    const parsed = parseInt(value || '', 10)
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function parseNumberEnv(value: string | undefined, fallback: number, min: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function check(name: string, value: number, limit: number, unit: string): RuntimeHealth['checks'][number] {
    const ratio = limit > 0 ? value / limit : 0
    return {
        name,
        value,
        limit,
        unit,
        status: ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'degraded' : 'ok',
    }
}

function getFdCount(): number | null {
    for (const dir of ['/proc/self/fd', '/dev/fd']) {
        try {
            return fs.readdirSync(dir).length
        } catch (_) {
            // Continue to the next platform-specific location.
        }
    }
    return null
}

function getActiveCount(name: '_getActiveHandles' | '_getActiveRequests'): number | null {
    const fn = (process as unknown as Record<string, unknown>)[name]
    if (typeof fn !== 'function') return null
    try {
        return (fn as () => unknown[])().length
    } catch (_) {
        return null
    }
}

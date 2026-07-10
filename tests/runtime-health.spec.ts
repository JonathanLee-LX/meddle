import { describe, expect, it } from 'vitest'
import { createRuntimeHealthMonitor, parseWatchdogConfig } from '../core/runtime-health'

describe('runtime health monitor', () => {
    it('parses watchdog configuration from environment', () => {
        const config = parseWatchdogConfig({
            EP_WATCHDOG: '1',
            EP_WATCHDOG_ACTION: 'warn',
            EP_WATCHDOG_CONNECTIONS: '12',
            EP_WATCHDOG_FAILURES: '2',
        } as NodeJS.ProcessEnv)

        expect(config.enabled).toBe(true)
        expect(config.action).toBe('warn')
        expect(config.connectionCount).toBe(12)
        expect(config.failureThreshold).toBe(2)
    })

    it('requests exit after sustained critical connection count', () => {
        const monitor = createRuntimeHealthMonitor({
            startedAt: Date.now() - 10_000,
            config: {
                enabled: true,
                action: 'exit',
                intervalMs: 1000,
                minUptimeMs: 0,
                failureThreshold: 2,
                cpuPercent: 10_000,
                rssBytes: Number.MAX_SAFE_INTEGER,
                connectionCount: 1,
                mitmServerCount: 100,
                fdCount: 100_000,
                eventLoopDelayMs: 10_000,
            },
            getSnapshotInput: () => ({
                connections: { proxySockets: 2, mitmTlsSockets: 0, webSockets: 0, total: 2 },
                mitmServers: [],
            }),
        })

        try {
            expect(monitor.evaluate().shouldExit).toBe(false)
            const second = monitor.evaluate()
            expect(second.shouldExit).toBe(true)
            expect(second.reasons.some(reason => reason.includes('connections'))).toBe(true)
        } finally {
            monitor.dispose()
        }
    })
})

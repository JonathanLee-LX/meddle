import { describe, it, expect } from 'vitest'
import { buildRefactorStatus } from '../core/refactor-status'

describe('refactor-status buildRefactorStatus', () => {
    it('returns normalized status payload', () => {
        const status = buildRefactorStatus({
            runtime: { pid: 1, uptimeSec: 10 },
            mode: 'shadow',
            allowlist: ['a.com'],
            readiness: { ready: false },
            advice: { suggestedMode: 'shadow' },
            shadowStats: { total: 10 },
            onModeGate: { checked: 10 },
            plugins: [{ id: 'builtin.router' }],
            loggerSummary: { totalResponses: 5 },
        })
        expect(status.mode).toBe('shadow')
        expect(status.runtime.pid).toBe(1)
        expect(status.allowlist).toEqual(['a.com'])
        expect(status.readiness.ready).toBe(false)
        expect(status.shadow.total).toBe(10)
        expect(status.plugins.length).toBe(1)
        expect(status.loggerSummary.totalResponses).toBe(5)
        expect(typeof status.generatedAt === 'number').toBeTruthy()
    })
})

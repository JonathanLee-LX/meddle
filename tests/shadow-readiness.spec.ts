import { describe, it, expect } from 'vitest'
import { evaluateShadowReadiness, buildReadinessAdvice } from '../core/shadow-readiness'

describe('shadow-readiness evaluateShadowReadiness', () => {
    it('returns insufficient_samples when total is below threshold', () => {
        const result = evaluateShadowReadiness(
            { total: 50, diffRate: 0.01 },
            { minSamples: 100, maxDiffRate: 0.05 }
        )
        expect(result.ready).toBe(false)
        expect(result.reason).toBe('insufficient_samples')
    })

    it('returns diff_rate_too_high when diff exceeds threshold', () => {
        const result = evaluateShadowReadiness(
            { total: 200, diffRate: 0.12 },
            { minSamples: 100, maxDiffRate: 0.05 }
        )
        expect(result.ready).toBe(false)
        expect(result.reason).toBe('diff_rate_too_high')
    })

    it('returns ready when thresholds are satisfied', () => {
        const result = evaluateShadowReadiness(
            { total: 300, diffRate: 0.01 },
            { minSamples: 100, maxDiffRate: 0.05 }
        )
        expect(result.ready).toBe(true)
        expect(result.reason).toBe('ok')
    })
})

describe('shadow-readiness buildReadinessAdvice', () => {
    it('suggests shadow when mode is off', () => {
        const advice = buildReadinessAdvice({ mode: 'off' })
        expect(advice.suggestedMode).toBe('shadow')
    })

    it('suggests keep shadow when diff rate is too high', () => {
        const advice = buildReadinessAdvice({
            mode: 'shadow',
            readiness: {
                ready: false,
                reason: 'diff_rate_too_high',
                minSamples: 100,
                diffRate: 0.2,
                maxDiffRate: 0.05,
            },
        })
        expect(advice.suggestedMode).toBe('shadow')
        expect(advice.level).toBe('warn')
    })

    it('suggests on when shadow is ready', () => {
        const advice = buildReadinessAdvice({
            mode: 'shadow',
            readiness: {
                ready: true,
                reason: 'ok',
                minSamples: 100,
                diffRate: 0.01,
                maxDiffRate: 0.05,
            },
            allowlist: ['a.com'],
        })
        expect(advice.suggestedMode).toBe('on')
        expect(advice.level).toBe('success')
    })
})

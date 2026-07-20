import { describe, it, expect } from 'vitest'
import { decideRoute } from '../core/route-decision'

describe('route-decision decideRoute', () => {
    it('uses pipeline path when canUse returns true', async () => {
        let calledEvaluate = 0
        const result = await decideRoute({
            source: 'https://a.com',
            method: 'GET',
            headers: {},
            reqBody: Buffer.from(''),
            legacyTarget: 'https://legacy.com',
            requestPipeline: {
                mode: 'on',
                evaluateRequest: async () => {
                    calledEvaluate += 1
                    return {
                        target: 'https://plugin.com',
                        observedTarget: 'https://plugin.com',
                        shortCircuited: false,
                        response: null,
                    }
                },
            },
            canUsePipelineExecuteForSource: () => true,
            observeShadowDecision: () => {},
            fallbackResolve: async () => ({ target: 'https://fallback.com', shortCircuited: false, response: null }),
        })
        expect(calledEvaluate).toBe(1)
        expect(result.target).toBe('https://plugin.com')
    })

    it('calls fallback when pipeline path is disabled', async () => {
        const result = await decideRoute({
            source: 'https://a.com',
            method: 'GET',
            headers: {},
            reqBody: Buffer.from(''),
            legacyTarget: 'https://legacy.com',
            requestPipeline: { mode: 'off', evaluateRequest: async () => ({}) },
            canUsePipelineExecuteForSource: () => false,
            observeShadowDecision: () => {},
            fallbackResolve: async () => ({ target: 'https://fallback.com', shortCircuited: false, response: null }),
        })
        expect(result.target).toBe('https://fallback.com')
    })

    it('emits shadow observation in shadow mode', async () => {
        let observed = null
        await decideRoute({
            source: 'https://a.com',
            method: 'GET',
            headers: {},
            reqBody: Buffer.from(''),
            legacyTarget: 'https://legacy.com',
            requestPipeline: {
                mode: 'shadow',
                evaluateRequest: async () => ({
                    target: 'https://legacy.com',
                    observedTarget: 'https://plugin.com',
                    shortCircuited: false,
                    response: null,
                }),
            },
            canUsePipelineExecuteForSource: () => true,
            observeShadowDecision: (...args) => {
                observed = args
            },
            fallbackResolve: async () => ({ target: 'https://fallback.com', shortCircuited: false, response: null }),
        })
        expect(Array.isArray(observed)).toBeTruthy()
        expect(observed[1]).toBe('https://a.com')
    })
})

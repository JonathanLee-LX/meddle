import { describe, it, expect } from 'vitest'
import { createPipelineGate } from '../core/pipeline-gate'

describe('pipeline-gate createPipelineGate', () => {
    it('uses onModeGate for on mode and allows shadow mode by default', () => {
        let checked = 0
        const gate = createPipelineGate({
            requestPipeline: { mode: 'shadow' },
            onModeGate: {
                shouldApply() {
                    checked += 1
                    return true
                },
            },
            enableBuiltinMockPlugin: true,
        })
        expect(gate.canUsePipelineExecuteForSource('https://a.com')).toBe(true)
        expect(checked).toBe(0)
    })

    it('delegates on-mode host check to onModeGate', () => {
        const gate = createPipelineGate({
            requestPipeline: { mode: 'on' },
            onModeGate: { shouldApply: () => false },
            enableBuiltinMockPlugin: true,
        })
        expect(gate.shouldApplyPipelineOnForSource('https://a.com')).toBe(false)
        expect(gate.canUsePipelineExecuteForSource('https://a.com')).toBe(false)
    })

    it('checks mock takeover through unified gate', () => {
        const gate = createPipelineGate({
            requestPipeline: { mode: 'on' },
            onModeGate: { shouldApply: () => true },
            enableBuiltinMockPlugin: true,
        })
        expect(
            gate.shouldUsePluginMockForRequest('https://a.com', { bodyType: 'inline' })
        ).toBe(true)
        expect(
            gate.shouldUsePluginMockForRequest('https://a.com', { bodyType: 'file' })
        ).toBe(false)
    })
})

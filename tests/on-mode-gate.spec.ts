const assert = require('assert')
const { parseHostAllowlist, createOnModeGate } = require('../dist/core/on-mode-gate')

describe('on-mode-gate parseHostAllowlist', () => {
    it('parses comma-separated hosts into normalized set', () => {
        const set = parseHostAllowlist('A.COM, b.com , ,C.com')
        assert.strictEqual(set.has('a.com'), true)
        assert.strictEqual(set.has('b.com'), true)
        assert.strictEqual(set.has('c.com'), true)
        assert.strictEqual(set.size, 3)
    })
})

describe('on-mode-gate createOnModeGate', () => {
    it('always skips when mode is not on', () => {
        const gate = createOnModeGate({ mode: 'shadow', allowlist: new Set() })
        assert.strictEqual(gate.shouldApply('https://a.com/path'), false)
        const stats = gate.getStats()
        assert.strictEqual(stats.checked, 1)
        assert.strictEqual(stats.skippedByMode, 1)
    })

    it('applies all hosts when allowlist is empty in on mode', () => {
        const gate = createOnModeGate({ mode: 'on', allowlist: new Set() })
        assert.strictEqual(gate.shouldApply('https://a.com/path'), true)
        const stats = gate.getStats()
        assert.strictEqual(stats.applied, 1)
    })

    it('applies only allowlisted hosts in on mode', () => {
        const gate = createOnModeGate({ mode: 'on', allowlist: new Set(['a.com']) })
        assert.strictEqual(gate.shouldApply('https://a.com/path'), true)
        assert.strictEqual(gate.shouldApply('https://b.com/path'), false)
        const stats = gate.getStats()
        assert.strictEqual(stats.applied, 1)
        assert.strictEqual(stats.skippedByAllowlist, 1)
    })

    it('counts invalid source url', () => {
        const gate = createOnModeGate({ mode: 'on', allowlist: new Set(['a.com']) })
        assert.strictEqual(gate.shouldApply('not-a-url'), false)
        const stats = gate.getStats()
        assert.strictEqual(stats.invalidSource, 1)
    })

    it('supports reset', () => {
        const gate = createOnModeGate({ mode: 'on', allowlist: new Set() })
        gate.shouldApply('https://a.com/path')
        gate.reset()
        const stats = gate.getStats()
        assert.strictEqual(stats.checked, 0)
        assert.strictEqual(stats.applied, 0)
    })
})

export {};

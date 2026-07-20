const assert = require('assert')
const { buildRefactorConfig, parseBool } = require('../dist/core/refactor-config')

describe('refactor-config parseBool', () => {
    it('parses truthy and falsy strings', () => {
        assert.strictEqual(parseBool('true', false), true)
        assert.strictEqual(parseBool('0', true), false)
        assert.strictEqual(parseBool('unknown', true), true)
    })
})

describe('refactor-config buildRefactorConfig', () => {
    it('builds config with defaults', () => {
        const cfg = buildRefactorConfig({}, {
            normalizeMode: (v) => v,
            parseHostAllowlist: () => new Set(),
        })
        assert.strictEqual(cfg.pluginMode, 'off')
        assert.strictEqual(cfg.shadowWarnMinSamples, 200)
        assert.strictEqual(cfg.shadowWarnDiffRate, 0.05)
        assert.strictEqual(cfg.enableBuiltinRouter, true)
        assert.strictEqual(cfg.enableBuiltinLogger, true)
        assert.strictEqual(cfg.enableBuiltinMock, false)
    })

    it('builds config from env overrides', () => {
        const cfg = buildRefactorConfig({
            MEDDLE_PLUGIN_MODE: 'shadow',
            MEDDLE_SHADOW_WARN_MIN_SAMPLES: '500',
            MEDDLE_SHADOW_WARN_DIFF_RATE: '0.2',
            MEDDLE_ENABLE_BUILTIN_ROUTER: 'false',
            MEDDLE_ENABLE_BUILTIN_LOGGER: '0',
            MEDDLE_ENABLE_BUILTIN_MOCK: '1',
            MEDDLE_PLUGIN_ON_HOSTS: 'a.com,b.com',
        }, {
            normalizeMode: (v) => v,
            parseHostAllowlist: (text) => new Set(text.split(',')),
        })
        assert.strictEqual(cfg.pluginMode, 'shadow')
        assert.strictEqual(cfg.shadowWarnMinSamples, 500)
        assert.strictEqual(cfg.shadowWarnDiffRate, 0.2)
        assert.strictEqual(cfg.enableBuiltinRouter, false)
        assert.strictEqual(cfg.enableBuiltinLogger, false)
        assert.strictEqual(cfg.enableBuiltinMock, true)
        assert.strictEqual(cfg.pluginOnHosts.has('a.com'), true)
    })
})

export {};

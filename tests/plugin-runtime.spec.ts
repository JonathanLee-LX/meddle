import { describe, it, expect } from 'vitest'
import { PluginManager, HookDispatcher } from '../core/plugin-runtime'

function createPlugin(overrides: any = {}) {
    return {
        manifest: {
            id: 'test.plugin',
            version: '1.0.0',
            apiVersion: '1.x',
            permissions: [],
            hooks: [],
            priority: 100,
            ...overrides.manifest,
        },
        async setup() {},
        ...overrides,
    }
}

describe('plugin-runtime PluginManager', () => {
    it('registers plugin and tracks state', () => {
        const manager = new PluginManager({ logger: { error() {} } })
        const plugin = createPlugin()
        manager.register(plugin)
        expect(manager.getState(plugin.manifest.id)).toBe('registered')
    })

    it('unregisters plugin and removes state', () => {
        const manager = new PluginManager({ logger: { error() {} } })
        const plugin = createPlugin()
        manager.register(plugin)
        manager.unregister(plugin.manifest.id)
        expect(manager.getAll()).toHaveLength(0)
        expect(manager.getState(plugin.manifest.id)).toBe('unknown')
    })

    it('disables plugin when lifecycle throws error', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        const plugin = createPlugin({
            setup: async () => {
                throw new Error('boom')
            },
        })
        manager.register(plugin)
        await manager.setup(() => ({}))
        expect(manager.getState(plugin.manifest.id)).toBe('disabled')
    })
})

describe('plugin-runtime HookDispatcher', () => {
    it('dispatches hooks by priority order', async () => {
        const calls = []
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.low',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                    priority: 200,
                },
                onBeforeProxy: async () => calls.push('low'),
            })
        )
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.high',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                    priority: 10,
                },
                onBeforeProxy: async () => calls.push('high'),
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 50,
        })

        const results = await dispatcher.dispatch('onBeforeProxy', { requestId: 'r1' })
        expect(calls).toEqual(['high', 'low'])
        expect(results.length).toBe(2)
        expect(results[0].status).toBe('ok')
        expect(results[1].status).toBe('ok')
    })

    it('marks timeout when hook exceeds time budget', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.slow',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onAfterResponse'],
                },
                onAfterResponse: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 20))
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 5,
        })

        const results = await dispatcher.dispatch('onAfterResponse', { requestId: 'r2' })
        expect(results.length).toBe(1)
        expect(results[0].status).toBe('timeout')
    })

    it('collects plugin hook stats', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.stats.ok',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: async () => {},
            })
        )
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.stats.err',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: async () => {
                    throw new Error('boom')
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 30,
        })
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'r3' })
        const stats = dispatcher.getPluginStats()
        expect(stats['plugin.stats.ok'].ok).toBe(1)
        expect(stats['plugin.stats.err'].error).toBe(1)
        expect(stats['plugin.stats.err'].lastError).toBe('boom')
    })

    it('auto-disables a plugin after consecutive hook failures (circuit breaker)', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.breaker',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: async () => {
                    throw new Error('always fails')
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 30,
            breakerThreshold: 3,
        })

        // First two failures: hook still runs (status 'error'), not yet tripped.
        const r1 = await dispatcher.dispatch('onBeforeProxy', { requestId: 'b1' })
        const r2 = await dispatcher.dispatch('onBeforeProxy', { requestId: 'b2' })
        expect(r1[0].status).toBe('error')
        expect(r2[0].status).toBe('error')
        expect(manager.getState('plugin.breaker')).not.toBe('disabled')

        // Third consecutive failure trips the breaker → plugin disabled.
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'b3' })
        expect(manager.getState('plugin.breaker')).toBe('disabled')

        // Subsequent hooks are skipped entirely.
        const r4 = await dispatcher.dispatch('onBeforeProxy', { requestId: 'b4' })
        expect(r4[0].status).toBe('skipped-disabled')
    })

    it('resets the breaker after a successful hook', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        let shouldFail = true
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.breaker.reset',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: async () => {
                    if (shouldFail) throw new Error('flaky')
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 30,
            breakerThreshold: 3,
        })

        await dispatcher.dispatch('onBeforeProxy', { requestId: 'c1' })
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'c2' })
        shouldFail = false
        // Success in between resets the consecutive-failure counter.
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'c3' })
        expect(manager.getState('plugin.breaker.reset')).not.toBe('disabled')

        shouldFail = true
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'c4' })
        await dispatcher.dispatch('onBeforeProxy', { requestId: 'c5' })
        // Still only 2 consecutive failures since c3 success → not tripped.
        expect(manager.getState('plugin.breaker.reset')).not.toBe('disabled')
    })

    it('marks a plugin slow when a hook blocks the event loop past the sync budget', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.syncslow',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: () => {
                    // Synchronous busy loop that blocks the event loop.
                    const end = Date.now() + 40
                    while (Date.now() < end) { /* block */ }
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 200, // async timeout would not fire for sync block
            syncBlockThresholdMs: 20,
        })

        await dispatcher.dispatch('onBeforeProxy', { requestId: 's1' })
        const stats = dispatcher.getPluginStats()
        expect(stats['plugin.syncslow'].slowCount).toBeGreaterThan(0)
        expect(stats['plugin.syncslow'].lastDuration).toBeGreaterThanOrEqual(20)
    })

    it('skips a plugin on subsequent hooks after it timed out (degrade not repeat)', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        let calls = 0
        manager.register(
            createPlugin({
                manifest: {
                    id: 'plugin.timeout.degrade',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onBeforeProxy'],
                },
                onBeforeProxy: async () => {
                    calls++
                    await new Promise((resolve) => setTimeout(resolve, 20))
                },
            })
        )
        await manager.setup(() => ({}))
        await manager.start()
        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 5,
            timeoutDegradeAfter: 1, // degrade after the first timeout
        })

        await dispatcher.dispatch('onBeforeProxy', { requestId: 't1' }) // times out, calls=1
        const r2 = await dispatcher.dispatch('onBeforeProxy', { requestId: 't2' }) // skipped
        expect(calls).toBe(1)
        expect(r2[0].status).toBe('skipped-degraded')
        expect(manager.getState('plugin.timeout.degrade')).toBe('degraded')
    })
})

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
})

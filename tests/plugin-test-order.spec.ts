import { describe, expect, it } from 'vitest'
import { selectTestPluginsForHook, sortPluginsByHookOrder } from '../server/plugins'

describe('plugin test hook ordering', () => {
    const plugins = [
        {
            manifest: {
                id: 'local.custom',
                name: 'Custom Plugin',
                hooks: ['onBeforeProxy'],
                priority: 100,
            },
        },
        {
            manifest: {
                id: 'builtin.router',
                name: 'Builtin Router',
                hooks: ['onBeforeProxy'],
                priority: 30,
            },
        },
        {
            manifest: {
                id: 'builtin.mock',
                name: 'Builtin Mock',
                hooks: ['onBeforeProxy'],
                priority: 20,
            },
        },
    ]

    it('orders plugins by priority then id', () => {
        const ordered = sortPluginsByHookOrder(plugins as any)
        expect(ordered.map((plugin) => plugin.manifest.id)).toEqual([
            'builtin.mock',
            'builtin.router',
            'local.custom',
        ])
    })

    it('includes builtin mock/router before target plugin for integrated flow', () => {
        const ordered = selectTestPluginsForHook(
            plugins as any,
            'onBeforeProxy',
            'local.custom',
            true,
        )

        expect(ordered.map((plugin) => plugin.manifest.id)).toEqual([
            'builtin.mock',
            'builtin.router',
            'local.custom',
        ])
    })

    it('only keeps the target plugin outside builtin flow', () => {
        const ordered = selectTestPluginsForHook(
            plugins as any,
            'onBeforeProxy',
            'local.custom',
            false,
        )

        expect(ordered.map((plugin) => plugin.manifest.id)).toEqual([
            'local.custom',
        ])
    })
})

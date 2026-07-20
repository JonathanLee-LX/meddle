import { describe, it, expect } from 'vitest'
import { bootstrapPlugins } from '../core/plugin-bootstrap'

describe('plugin-bootstrap bootstrapPlugins', () => {
    it('registers plugins and starts manager lifecycle', async () => {
        const calls = []
        const manager = {
            register(plugin) {
                calls.push(['register', plugin.id])
            },
            async setup(contextFactory) {
                calls.push(['setup', typeof contextFactory])
            },
            async start() {
                calls.push(['start'])
            },
        }
        await bootstrapPlugins({
            pluginManager: manager,
            plugins: [{ id: 'p1' }, { id: 'p2' }],
            contextFactory: () => ({}),
        })
        expect(calls).toEqual([
            ['register', 'p1'],
            ['register', 'p2'],
            ['setup', 'function'],
            ['start'],
        ])
    })
})

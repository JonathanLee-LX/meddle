import { describe, it, expect } from 'vitest'
import { buildPluginHealth } from '../core/plugin-health'

describe('plugin-health buildPluginHealth', () => {
    it('returns healthy overall when all running without failures', () => {
        const result = buildPluginHealth({
            plugins: [
                { id: 'builtin.router', name: 'router', version: '1.0.0' },
                { id: 'builtin.logger', name: 'logger', version: '1.0.0' },
            ],
            pluginStates: {
                'builtin.router': 'running',
                'builtin.logger': 'running',
            },
            pluginStats: {
                'builtin.router': { total: 10, error: 0, timeout: 0 },
                'builtin.logger': { total: 10, error: 0, timeout: 0 },
            },
        })
        expect(result.overall).toBe('healthy')
        expect(result.counts.healthy).toBe(2)
    })

    it('returns degraded overall when plugin is disabled or failing', () => {
        const result = buildPluginHealth({
            plugins: [
                { id: 'builtin.router', name: 'router', version: '1.0.0' },
                { id: 'builtin.mock', name: 'mock', version: '1.0.0' },
            ],
            pluginStates: {
                'builtin.router': 'running',
                'builtin.mock': 'disabled',
            },
            pluginStats: {
                'builtin.router': { total: 4, error: 1, timeout: 0 },
            },
        })
        expect(result.overall).toBe('degraded')
        expect(result.counts.degraded).toBe(1)
        expect(result.counts.disabled).toBe(1)
    })
})

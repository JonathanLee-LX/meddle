import { describe, it, expect } from 'vitest'
import { createBuiltinPlugins } from '../plugins/builtin'

describe('plugins/builtin createBuiltinPlugins', () => {
    it('builds plugin list based on enable flags', () => {
        const logger = { id: 'logger' }
        const plugins = createBuiltinPlugins({
            enableMock: true,
            enableRouter: false,
            enableLogger: true,
            createMockPlugin: () => ({ id: 'mock' }),
            createRouterPlugin: () => ({ id: 'router' }),
            findMockMatch: () => null,
            getRuleMap: () => ({}),
            loggerPlugin: logger,
        })
        expect(plugins.length).toBe(2)
        expect(plugins[0].id).toBe('mock')
        expect(plugins[1]).toBe(logger)
    })
})

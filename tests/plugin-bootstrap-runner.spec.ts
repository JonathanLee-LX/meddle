import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPluginBootstrapRunner } from '../core/plugin-bootstrap-runner'
import { PluginManager } from '../core/plugin-runtime'

const loadCustomPluginsMock = vi.fn()

vi.mock('../core/custom-plugin-loader', () => ({
    loadCustomPlugins: (...args: any[]) => loadCustomPluginsMock(...args),
}))

describe('plugin-bootstrap-runner createPluginBootstrapRunner', () => {
    beforeEach(() => {
        loadCustomPluginsMock.mockReset()
        loadCustomPluginsMock.mockResolvedValue([])
    })

    function makeCtx(overrides: any = {}) {
        return {
            epDir: '/tmp/ep-pbr-test',
            settingsPath: '/tmp/ep-pbr-test/settings.json',
            ENABLE_BUILTIN_MOCK_PLUGIN: false,
            ENABLE_BUILTIN_ROUTER_PLUGIN: false,
            ENABLE_BUILTIN_LOGGER_PLUGIN: false,
            builtinLoggerPlugin: { manifest: { id: 'builtin-logger' } },
            pluginManager: {
                register: () => {},
                getState: () => 'unknown',
                setState: () => {},
            },
            ruleMap: {},
            ...overrides,
        }
    }

    function makeMockHandler() {
        return {
            matchMockRule: () => null,
            getMockFilePath: () => '/tmp/mocks.json',
            loadMockRules: () => {},
            saveMockRules: () => {},
            buildMockResponseForTest: () => ({ statusCode: 200, headers: {}, body: '' }),
            sendMockResponse: () => {},
            loadCustomPathsFromSettings: () => ({ mocksFilePath: null }),
        }
    }

    it('returns an object with bootstrapBuiltinPlugins and reloadCustomPlugins', () => {
        const ctx = makeCtx()
        const runner = createPluginBootstrapRunner(ctx, makeMockHandler())
        expect(typeof runner.bootstrapBuiltinPlugins).toBe('function')
        expect(typeof runner.reloadCustomPlugins).toBe('function')
    })

    it('reloadCustomPlugins returns a promise', async () => {
        const ctx = makeCtx()
        const runner = createPluginBootstrapRunner(ctx, makeMockHandler())
        const result = runner.reloadCustomPlugins()
        expect(result instanceof Promise).toBeTruthy()
        const plugins = await result
        expect(Array.isArray(plugins)).toBeTruthy()
    })

    it('reloadCustomPlugins replaces plugin with same id', async () => {
        const pluginManager = new PluginManager({ logger: { error() {} } })
        const ctx = makeCtx({
            pluginManager,
        })
        const runner = createPluginBootstrapRunner(ctx, makeMockHandler())

        loadCustomPluginsMock.mockResolvedValueOnce([
            {
                manifest: {
                    id: 'local.demo',
                    name: 'Demo Plugin',
                    version: '1.0.0',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onAfterResponse'],
                    priority: 100,
                    type: 'local',
                },
                async setup() {},
                async onAfterResponse(context: any) {
                    context.response.headers['x-demo-version'] = 'v1'
                },
            },
        ])
        await runner.reloadCustomPlugins()
        let plugins = pluginManager.getAll().filter((plugin: any) => plugin.manifest.id === 'local.demo')
        expect(plugins).toHaveLength(1)

        loadCustomPluginsMock.mockResolvedValueOnce([
            {
                manifest: {
                    id: 'local.demo',
                    name: 'Demo Plugin',
                    version: '1.0.1',
                    apiVersion: '1.x',
                    permissions: [],
                    hooks: ['onAfterResponse'],
                    priority: 100,
                    type: 'local',
                },
                async setup() {},
                async onAfterResponse(context: any) {
                    context.response.headers['x-demo-version'] = 'v2'
                },
            },
        ])
        await runner.reloadCustomPlugins()
        plugins = pluginManager.getAll().filter((plugin: any) => plugin.manifest.id === 'local.demo')
        expect(plugins).toHaveLength(1)

        const responseCtx: any = { response: { headers: {}, body: '', statusCode: 200 } }
        await plugins[0].onAfterResponse(responseCtx)
        expect(responseCtx.response.headers['x-demo-version']).toBe('v2')
    })
})

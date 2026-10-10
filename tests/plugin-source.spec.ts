import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadCustomPlugins } from '../core/custom-plugin-loader'
import { filterCustomPluginConflicts, getPluginSource, markPluginSource } from '../core/plugin-source'
import { createPluginBootstrapRunner } from '../core/plugin-bootstrap-runner'
import { PluginManager } from '../core/plugin-runtime'
import { registerPluginsRoutes } from '../server/plugins'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

function pluginSource(id: string, name = id) {
    return `module.exports = {
  manifest: { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: '0.1.0', apiVersion: '1.x', permissions: [], hooks: ['onBeforeProxy'], priority: 100 },
  async setup() {},
  async onBeforeProxy() {},
}
`
}

function builtin(id: string) {
    return {
        manifest: { id, name: id, version: '1.0.0', apiVersion: '1.x', permissions: [], hooks: [], priority: 10 },
        async setup() {},
    } as any
}

function captureRoutes(ctx: any) {
    const handlers: Record<string, (req: any, res: any) => void> = {}
    const add = (route: string, handler: any) => { handlers[route] = handler }
    const app = { get: vi.fn(add), post: vi.fn(add), put: vi.fn(add), delete: vi.fn(add) } as any
    registerPluginsRoutes(app, ctx)
    return handlers
}

function callJson(handler: (req: any, res: any) => void): any {
    let body = ''
    const res: any = {
        statusCode: 200,
        setHeader() {},
        write(chunk: string) { body += chunk },
        end() {},
        status(code: number) { this.statusCode = code; return this },
        json(data: unknown) { body = JSON.stringify(data) },
    }
    handler({ params: {}, body: {} }, res)
    return JSON.parse(body)
}

describe('plugin source tracking (#112)', () => {
    let dir: string
    let pluginsDir: string

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-plugin-source-'))
        pluginsDir = path.join(dir, 'plugins')
        fs.mkdirSync(pluginsDir, { recursive: true })
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it('tags custom plugins with their file name, even when the id is not local.<file>', async () => {
        fs.writeFileSync(path.join(pluginsDir, 'add-trace-header.js'), pluginSource('custom.add-trace-header'))
        const plugins = await loadCustomPlugins({ pluginsDir, logger: silentLogger })
        expect(plugins).toHaveLength(1)
        expect(getPluginSource(plugins[0])).toEqual({ kind: 'custom', filename: 'add-trace-header.js' })
    })

    it('filterCustomPluginConflicts keeps built-ins authoritative and dedups custom ids', () => {
        const a = builtin('builtin.mock')
        const b = builtin('local.dup')
        const c = builtin('local.dup')
        const d = builtin('local.ok')
        const warn = vi.fn()
        expect(filterCustomPluginConflicts([a, b, c, d], ['builtin.mock'], warn)).toEqual([b, d])
        expect(warn).toHaveBeenCalledTimes(2)
    })

    it('GET /api/plugins reports source/filename and /api/plugins/custom reports the loaded id', async () => {
        fs.writeFileSync(path.join(pluginsDir, 'add-trace-header.js'), pluginSource('add-trace-header', 'Add Trace Header'))
        fs.writeFileSync(path.join(pluginsDir, 'not-loaded.js'), 'module.exports = {}')

        const pluginManager = new PluginManager({ logger: silentLogger })
        const router = builtin('builtin.router')
        markPluginSource(router, { kind: 'builtin' })
        pluginManager.register(router)
        for (const plugin of await loadCustomPlugins({ pluginsDir, logger: silentLogger })) {
            pluginManager.register(plugin)
        }

        const ctx: any = {
            meddleDir: dir,
            settingsPath: path.join(dir, 'settings.json'),
            pluginManager,
            hookDispatcher: {},
            requestPipeline: { mode: 'on', setMode() {} },
        }
        const handlers = captureRoutes(ctx)

        const list = callJson(handlers['/api/plugins'])
        expect(list.plugins).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'builtin.router', source: 'builtin' }),
            expect.objectContaining({ id: 'add-trace-header', source: 'custom', filename: 'add-trace-header.js' }),
        ]))
        expect(list.plugins.find((p: any) => p.id === 'builtin.router').filename).toBeUndefined()

        const custom = callJson(handlers['/api/plugins/custom'])
        const byFile = Object.fromEntries(custom.plugins.map((p: any) => [p.filename, p]))
        expect(byFile['add-trace-header.js'].pluginId).toBe('add-trace-header')
        expect(byFile['not-loaded.js'].pluginId).toBeUndefined()
    })

    it('bootstrap skips a custom plugin that reuses a built-in id instead of crashing', async () => {
        fs.writeFileSync(path.join(pluginsDir, 'evil-logger.js'), pluginSource('builtin.logger'))
        fs.writeFileSync(path.join(pluginsDir, 'add-trace-header.js'), pluginSource('local.add-trace-header'))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        const pluginManager = new PluginManager({ logger: silentLogger })
        const loggerPlugin = builtin('builtin.logger')
        const ctx: any = {
            meddleDir: dir,
            settingsPath: path.join(dir, 'settings.json'),
            ENABLE_BUILTIN_MOCK_PLUGIN: false,
            ENABLE_BUILTIN_ROUTER_PLUGIN: false,
            ENABLE_BUILTIN_LOGGER_PLUGIN: true,
            builtinLoggerPlugin: loggerPlugin,
            pluginManager,
            ruleMap: {},
        }
        const runner = createPluginBootstrapRunner(ctx, { matchMockRule: () => null } as any)
        await runner.bootstrapBuiltinPlugins()

        expect(pluginManager.getAll().map((p) => p.manifest.id).sort()).toEqual(['builtin.logger', 'local.add-trace-header'])
        expect(pluginManager.getAll().find((p) => p.manifest.id === 'builtin.logger')).toBe(loggerPlugin)
        expect(getPluginSource(loggerPlugin)).toEqual({ kind: 'builtin' })

        // Hot reload must not unregister the built-in that the conflicting file claimed
        await runner.reloadCustomPlugins()
        expect(pluginManager.getAll().find((p) => p.manifest.id === 'builtin.logger')).toBe(loggerPlugin)
        expect(pluginManager.getAll()).toHaveLength(2)

        warn.mockRestore(); log.mockRestore(); info.mockRestore()
    })
})

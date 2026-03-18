import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { bootstrapPlugins } from './plugin-bootstrap'
import { loadCustomPlugins } from './custom-plugin-loader'
import { createBuiltinPlugins } from '../plugins/builtin'
import { createBuiltinRouterPlugin } from '../plugins/builtin/router-plugin'
import { createBuiltinMockPlugin } from '../plugins/builtin/mock-plugin'
import type { ProxyContext, MockHandler, Plugin } from './types'

export function createPluginBootstrapRunner(ctx: ProxyContext, mockHandler: MockHandler) {
    let loadedCustomPlugins: Plugin[] = []

    async function loadCustomPluginsInternal(customPluginsDir: string): Promise<Plugin[]> {
        let customPlugins: Plugin[] = []
        try {
            customPlugins = await loadCustomPlugins({ pluginsDir: customPluginsDir, logger: console })
            console.log(chalk.green(`已加载 ${customPlugins.length} 个自定义插件`))
        } catch (error: any) {
            console.warn(chalk.yellow('加载自定义插件失败:'), error.message)
        }
        return customPlugins
    }

    function restoreDisabledPlugins(): void {
        try {
            if (fs.existsSync(ctx.settingsPath)) {
                const s = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
                if (Array.isArray(s.disabledPlugins)) {
                    for (const id of s.disabledPlugins) {
                        if (ctx.pluginManager.getState(id) !== 'unknown') {
                            ctx.pluginManager.setState(id, 'disabled')
                            console.log(chalk.yellow(`插件 ${id} 已禁用（来自设置）`))
                        }
                    }
                }
            }
        } catch (_) { /* ignore */ }
    }

    async function bootstrapBuiltinPlugins(): Promise<void> {
        const plugins = createBuiltinPlugins({
            enableMock: ctx.ENABLE_BUILTIN_MOCK_PLUGIN,
            enableRouter: ctx.ENABLE_BUILTIN_ROUTER_PLUGIN,
            enableLogger: ctx.ENABLE_BUILTIN_LOGGER_PLUGIN,
            createMockPlugin: createBuiltinMockPlugin,
            createRouterPlugin: createBuiltinRouterPlugin,
            findMockMatch: (url: string, method?: string) => mockHandler.matchMockRule(url, method || '*'),
            getRuleMap: () => ctx.ruleMap,
            loggerPlugin: ctx.builtinLoggerPlugin,
        })

        const customPluginsDir = path.resolve(ctx.epDir, 'plugins')
        loadedCustomPlugins = await loadCustomPluginsInternal(customPluginsDir)

        const allPlugins: Plugin[] = [...plugins, ...loadedCustomPlugins]
        await bootstrapPlugins({
            pluginManager: ctx.pluginManager,
            plugins: allPlugins,
            contextFactory: (manifest: any) => ({ manifest, log: console }),
        })

        restoreDisabledPlugins()
    }

    async function reloadCustomPlugins(): Promise<Plugin[]> {
        const customPluginsDir = path.resolve(ctx.epDir, 'plugins')
        const newCustomPlugins = await loadCustomPluginsInternal(customPluginsDir)

        for (const oldPlugin of loadedCustomPlugins) {
            try {
                if (typeof oldPlugin.stop === 'function') await oldPlugin.stop!()
            }
            catch (error: any) { console.error('停止插件失败:', oldPlugin.manifest.id, error.message) }
            try { if (typeof oldPlugin.dispose === 'function') await oldPlugin.dispose!() }
            catch (error: any) { console.error('卸载插件失败:', oldPlugin.manifest.id, error.message) }
            try {
                if (typeof ctx.pluginManager.unregister === 'function') {
                    ctx.pluginManager.unregister(oldPlugin.manifest.id)
                }
            } catch (error: any) {
                console.error('注销插件失败:', oldPlugin.manifest.id, error.message)
            }
        }

        for (const newPlugin of newCustomPlugins) {
            try {
                ctx.pluginManager.register(newPlugin)
                const context = { manifest: newPlugin.manifest, log: console }
                await newPlugin.setup(context)
                if (typeof newPlugin.start === 'function') await newPlugin.start!()
                console.log(chalk.green(`已热加载插件: ${newPlugin.manifest.id}`))
            } catch (error: any) { console.error('热加载插件失败:', newPlugin.manifest.id, error.message) }
        }

        loadedCustomPlugins = newCustomPlugins
        restoreDisabledPlugins()
        return newCustomPlugins
    }

    return { bootstrapBuiltinPlugins, reloadCustomPlugins }
}

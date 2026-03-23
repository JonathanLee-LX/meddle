import * as path from 'path'
import chokidar from 'chokidar'
import chalk from 'chalk'
import _debug from 'debug'
import type { ProxyContext } from './types'
import { ensureRouteRules, mergeActiveRules, listRuleFiles } from '../server/rule-files'

const log = _debug('log')

interface ServerContextLike {
    ruleMap: Record<string, string>;
    excludeMap: Record<string, string[]>;
    broadcastToAllClients: (data: any) => void;
    [key: string]: any;
}

export function createRouteLoader(ctx: ProxyContext, serverContext: ServerContextLike) {

    function logRuleMap(): void {
        const ruleCount = Object.keys(ctx.ruleMap).length
        const files = listRuleFiles(serverContext as any)
        const enabledFiles = files.filter((f: any) => f.enabled)
        if (enabledFiles.length > 0) {
            console.log(chalk.green(`已加载 ${enabledFiles.length} 个规则文件 (共 ${ruleCount} 条规则):`))
            enabledFiles.forEach((f: any) => console.log(chalk.green(`  - ${f.name} (${f.ruleCount} 条)`)))
        } else {
            console.log(chalk.yellow(`无已启用的规则文件 (${files.length} 个可用)`))
        }
    }

    function reloadAllRuleFiles(): void {
        const { ruleMap, excludeMap } = mergeActiveRules(serverContext as any)
        ctx.ruleMap = ruleMap
        ctx.excludeMap = excludeMap
        serverContext.ruleMap = ctx.ruleMap
        serverContext.excludeMap = ctx.excludeMap
        logRuleMap()
        serverContext.broadcastToAllClients({
            type: 'rulesUpdated',
            rules: Object.entries(ctx.ruleMap).map(([rule, target]) => ({ rule, target, enabled: true }))
        })
    }

    function initRouteRules(): void {
        const activeNames: string[] = ensureRouteRules(serverContext as any)
        const { ruleMap, excludeMap } = mergeActiveRules(serverContext as any)
        ctx.ruleMap = ruleMap
        ctx.excludeMap = excludeMap
        serverContext.ruleMap = ctx.ruleMap
        serverContext.excludeMap = ctx.excludeMap
        logRuleMap()

        const rulesDir = path.join(ctx.epDir, 'route-rules')
        const watcher = chokidar.watch(rulesDir, { ignoreInitial: true })
        watcher.on('change', (changedPath: string) => {
            log(chalk.green(`route-rules file changed: ${path.basename(changedPath)}`))
            reloadAllRuleFiles()
        })
        const proxyDebug = _debug('proxy')
        proxyDebug('已加载规则文件:', activeNames.join(', ') || '(无)')
    }

    return { logRuleMap, reloadAllRuleFiles, initRouteRules }
}

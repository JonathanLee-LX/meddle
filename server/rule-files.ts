import * as fs from 'fs'
import * as path from 'path'
import { Application, Request, Response } from 'express'
import { ServerContext, RuleMap } from './index'
import { parseEprcWithExclusions, routeRulesToLegacyMaps, type ExcludeMap, type RouteRuleEntry } from '../helpers'

const DEFAULT_RULE_NAME = '默认规则'

function getRulesDir(ctx: ServerContext): string {
    return path.join(ctx.epDir, 'route-rules')
}

function ensureRulesDir(ctx: ServerContext): void {
    const dir = getRulesDir(ctx)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
}

function ruleFilePath(ctx: ServerContext, name: string): string {
    return path.join(getRulesDir(ctx), `${name}.txt`)
}

function loadSettings(ctx: ServerContext): Record<string, unknown> {
    try {
        if (fs.existsSync(ctx.settingsPath)) {
            return JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
        }
    } catch { /* ignore */ }
    return {}
}

function saveSettings(ctx: ServerContext, settings: Record<string, unknown>): void {
    const dir = path.dirname(ctx.settingsPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(ctx.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

function getActiveFileNames(ctx: ServerContext): string[] {
    const settings = loadSettings(ctx)
    const arr = settings.activeRuleFiles
    return Array.isArray(arr) ? arr : []
}

function setActiveFileNames(ctx: ServerContext, names: string[]): void {
    const settings = loadSettings(ctx)
    settings.activeRuleFiles = names
    saveSettings(ctx, settings)
}

export interface RuleFileInfo {
    name: string
    enabled: boolean
    ruleCount: number
    excludeCount: number
}

/**
 * Scan the route-rules directory and return file info list.
 */
export function listRuleFiles(ctx: ServerContext): RuleFileInfo[] {
    const dir = getRulesDir(ctx)
    ensureRulesDir(ctx)
    const activeNames = getActiveFileNames(ctx)

    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.txt'))
        .map(f => f.replace(/\.txt$/, ''))

    return files.map(name => {
        const filePath = ruleFilePath(ctx, name)
        let ruleCount = 0
        let excludeCount = 0
        try {
            const content = fs.readFileSync(filePath, 'utf8')
            const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
            ruleCount = Object.keys(ruleMap).length
            // Count total exclusions across all rules
            for (const exclusions of Object.values(excludeMap)) {
                excludeCount += exclusions.length
            }
        } catch { /* ignore */ }
        return {
            name,
            enabled: activeNames.includes(name),
            ruleCount,
            excludeCount,
        }
    })
}

export interface MergedRules {
    rules: RouteRuleEntry[];
    ruleMap: RuleMap;
    excludeMap: ExcludeMap;
}

/**
 * 按启用文件顺序合并路由规则；匹配时按 rules 数组顺序逐条验证。
 */
export function mergeActiveRules(ctx: ServerContext): MergedRules {
    const dir = getRulesDir(ctx)
    ensureRulesDir(ctx)
    const activeNames = getActiveFileNames(ctx)
    const mergedRules: RouteRuleEntry[] = []

    for (const name of activeNames) {
        const filePath = path.join(dir, `${name}.txt`)
        if (!fs.existsSync(filePath)) continue
        try {
            const content = fs.readFileSync(filePath, 'utf8')
            const { rules } = parseEprcWithExclusions(content)
            mergedRules.push(...rules)
        } catch (err) {
            console.error(`Failed to load rules from ${filePath}:`, err)
        }
    }

    const { ruleMap, excludeMap } = routeRulesToLegacyMaps(mergedRules)
    return { rules: mergedRules, ruleMap, excludeMap }
}

/**
 * Ensure the route-rules directory exists and has at least one default file.
 * Returns the list of active file names.
 */
export function ensureRouteRules(ctx: ServerContext): string[] {
    ensureRulesDir(ctx)
    const dir = getRulesDir(ctx)
    const txtFiles = fs.readdirSync(dir).filter(f => f.endsWith('.txt'))

    if (txtFiles.length === 0) {
        const defaultPath = path.join(dir, `${DEFAULT_RULE_NAME}.txt`)
        fs.writeFileSync(defaultPath, '', 'utf8')
    }

    let activeNames = getActiveFileNames(ctx)
    if (activeNames.length === 0) {
        const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, ''))
        if (allFiles.length > 0) {
            activeNames = [allFiles[0]]
            setActiveFileNames(ctx, activeNames)
        }
    }

    return activeNames
}

export function registerRuleFilesRoutes(app: Application, ctx: ServerContext): void {
    // GET /api/rule-files - 列出所有规则文件
    app.get('/api/rule-files', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        res.write(JSON.stringify(listRuleFiles(ctx)))
        res.end()
    })

    // POST /api/rule-files - 创建新规则文件
    app.post('/api/rule-files', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const { name, content = '', enabled = true } = req.body
            if (!name || !name.trim()) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '缺少文件名称' }))
                res.end()
                return
            }

            const safeName = name.trim().replace(/[/\\:*?"<>|]/g, '_')
            const filePath = ruleFilePath(ctx, safeName)

            if (fs.existsSync(filePath)) {
                res.statusCode = 409
                res.write(JSON.stringify({ error: `规则文件 "${safeName}" 已存在` }))
                res.end()
                return
            }

            ensureRulesDir(ctx)
            fs.writeFileSync(filePath, content, 'utf8')

            if (enabled) {
                const activeNames = getActiveFileNames(ctx)
                if (!activeNames.includes(safeName)) {
                    activeNames.push(safeName)
                    setActiveFileNames(ctx, activeNames)
                }
            }

            ctx.reloadAllRuleFiles()

            const ruleCount = Object.keys(parseEprcWithExclusions(content).ruleMap).length
            res.write(JSON.stringify({ status: 'success', ruleFile: { name: safeName, enabled, ruleCount } }))
        } catch (err) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (err as Error).message }))
        }
        res.end()
    })

    // GET /api/rule-files/:name/content - 获取规则文件内容
    app.get('/api/rule-files/:name/content', (req: Request, res: Response) => {
        const name = decodeURIComponent(req.params.name as string)
        const filePath = ruleFilePath(ctx, name)

        if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.write(JSON.stringify({ error: '规则文件不存在' }))
            res.end()
            return
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.write(fs.readFileSync(filePath, 'utf8'))
        res.end()
    })

    // PUT /api/rule-files/:name/content - 保存规则文件内容
    app.put('/api/rule-files/:name/content', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const name = decodeURIComponent(req.params.name as string)
        const filePath = ruleFilePath(ctx, name)

        if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.write(JSON.stringify({ error: '规则文件不存在' }))
            res.end()
            return
        }

        try {
            const text = typeof req.body === 'string' ? req.body : (req.body.content ?? '')
            fs.writeFileSync(filePath, text, 'utf8')
            ctx.reloadAllRuleFiles()
            res.write(JSON.stringify({ status: 'success' }))
        } catch (err) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (err as Error).message }))
        }
        res.end()
    })

    // PUT /api/rule-files/:name - 更新规则文件属性（启用/禁用、重命名）
    app.put('/api/rule-files/:name', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const name = decodeURIComponent(req.params.name as string)
        const filePath = ruleFilePath(ctx, name)

        if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.write(JSON.stringify({ error: '规则文件不存在' }))
            res.end()
            return
        }

        try {
            const { enabled, newName } = req.body
            let currentName = name
            const activeNames = getActiveFileNames(ctx)

            if (newName && newName.trim() && newName.trim() !== name) {
                const safeName = newName.trim().replace(/[/\\:*?"<>|]/g, '_')
                const newPath = ruleFilePath(ctx, safeName)
                if (fs.existsSync(newPath)) {
                    res.statusCode = 409
                    res.write(JSON.stringify({ error: `规则文件 "${safeName}" 已存在` }))
                    res.end()
                    return
                }
                fs.renameSync(filePath, newPath)
                const idx = activeNames.indexOf(name)
                if (idx !== -1) activeNames[idx] = safeName
                currentName = safeName
            }

            if (enabled !== undefined) {
                const idx = activeNames.indexOf(currentName)
                if (enabled && idx === -1) {
                    activeNames.push(currentName)
                } else if (!enabled && idx !== -1) {
                    activeNames.splice(idx, 1)
                }
            }

            setActiveFileNames(ctx, activeNames)
            ctx.reloadAllRuleFiles()

            res.write(JSON.stringify({ status: 'success', name: currentName }))
        } catch (err) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (err as Error).message }))
        }
        res.end()
    })

    // DELETE /api/rule-files/:name - 删除规则文件
    app.delete('/api/rule-files/:name', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const name = decodeURIComponent(req.params.name as string)
        const filePath = ruleFilePath(ctx, name)

        if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.write(JSON.stringify({ error: '规则文件不存在' }))
            res.end()
            return
        }

        try {
            fs.unlinkSync(filePath)

            const activeNames = getActiveFileNames(ctx)
            const idx = activeNames.indexOf(name)
            if (idx !== -1) {
                activeNames.splice(idx, 1)
                setActiveFileNames(ctx, activeNames)
            }

            ctx.reloadAllRuleFiles()
            res.write(JSON.stringify({ status: 'success' }))
        } catch (err) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (err as Error).message }))
        }
        res.end()
    })
}

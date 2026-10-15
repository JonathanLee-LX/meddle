import * as fs from 'fs'
import * as path from 'path'
import { Application, Request, Response } from 'express'
import { ServerContext, RuleMap } from './index'
import { parseEprcWithExclusions, routeRulesToLegacyMaps, type ExcludeMap, type RouteRuleEntry } from '../helpers'
import {
    assertRuleFileWritable,
    assertRuleFilesWritable,
    getReadonlyRuleFileNames,
    getUiToken,
    hasValidUiToken,
    isRuleFileReadonly,
    isRulesetReadonlyError,
    isSameOriginRequest,
    rulesetReadonlyBody,
    RULESET_READONLY_STATUS,
    setRuleFileReadonly,
} from './ruleset-lock'

const DEFAULT_RULE_NAME = '默认规则'

function getRulesDir(ctx: ServerContext): string {
    return path.join(ctx.meddleDir, 'route-rules')
}

function ensureRulesDir(ctx: ServerContext): void {
    const dir = getRulesDir(ctx)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
}

function normalizeRuleFileName(name: string): string {
    const safeName = name.trim().replace(/[/\\:*?"<>|]/g, '_')
    if (!safeName) {
        throw new Error('缺少规则文件名称')
    }
    return safeName
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

function getStoredRuleFileOrder(ctx: ServerContext): string[] {
    const settings = loadSettings(ctx)
    const arr = settings.ruleFileOrder
    return Array.isArray(arr) ? arr.filter((name): name is string => typeof name === 'string') : []
}

function setStoredRuleFileOrder(ctx: ServerContext, names: string[]): void {
    const settings = loadSettings(ctx)
    settings.ruleFileOrder = names
    saveSettings(ctx, settings)
}

/**
 * Resolve display/tab order for rule files.
 * Prefer persisted ruleFileOrder; when empty, seed as activeRuleFiles then remaining disk names
 * so existing merge order is preserved for enabled files.
 */
export function resolveRuleFileOrder(diskNames: string[], storedOrder: string[], activeNames: string[]): string[] {
    const diskSet = new Set(diskNames)
    const ordered: string[] = []
    const seen = new Set<string>()

    const pushUnique = (name: string) => {
        if (!diskSet.has(name) || seen.has(name)) return
        ordered.push(name)
        seen.add(name)
    }

    if (storedOrder.length > 0) {
        for (const name of storedOrder) pushUnique(name)
    } else {
        for (const name of activeNames) pushUnique(name)
    }

    for (const name of diskNames) pushUnique(name)
    return ordered
}

/** Keep activeRuleFiles relative order aligned with tab/file order. */
export function syncActiveRuleFilesToOrder(activeNames: string[], fileOrder: string[]): string[] {
    const activeSet = new Set(activeNames)
    const synced = fileOrder.filter((name) => activeSet.has(name))
    for (const name of activeNames) {
        if (!synced.includes(name)) synced.push(name)
    }
    return synced
}

function readDiskRuleFileNames(ctx: ServerContext): string[] {
    const dir = getRulesDir(ctx)
    ensureRulesDir(ctx)
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => f.replace(/\.txt$/, ''))
}

function ensureRuleFileInOrder(ctx: ServerContext, name: string): string[] {
    const diskNames = readDiskRuleFileNames(ctx)
    const ordered = resolveRuleFileOrder(diskNames, getStoredRuleFileOrder(ctx), getActiveFileNames(ctx))
    if (!ordered.includes(name)) ordered.push(name)
    setStoredRuleFileOrder(ctx, ordered)
    return ordered
}

function renameRuleFileInOrder(ctx: ServerContext, oldName: string, newName: string): void {
    const diskNames = readDiskRuleFileNames(ctx)
    const ordered = resolveRuleFileOrder(diskNames, getStoredRuleFileOrder(ctx), getActiveFileNames(ctx))
    const next: string[] = []
    const seen = new Set<string>()
    for (const name of ordered) {
        const resolved = name === oldName ? newName : name
        if (seen.has(resolved)) continue
        next.push(resolved)
        seen.add(resolved)
    }
    if (!seen.has(newName)) next.push(newName)
    setStoredRuleFileOrder(ctx, next)
}

function removeRuleFileFromOrder(ctx: ServerContext, name: string): void {
    const ordered = getStoredRuleFileOrder(ctx).filter((item) => item !== name)
    setStoredRuleFileOrder(ctx, ordered)
}

export function setRuleFileOrder(ctx: ServerContext, names: string[]): string[] {
    ensureRulesDir(ctx)
    const diskNames = readDiskRuleFileNames(ctx)
    const diskSet = new Set(diskNames)
    const safeNames = names.map((name) => normalizeRuleFileName(name))

    if (
        safeNames.length !== diskNames.length
        || new Set(safeNames).size !== safeNames.length
        || safeNames.some((name) => !diskSet.has(name))
    ) {
        throw new Error('规则文件顺序必须包含全部现有文件且无重复')
    }

    const activeNames = getActiveFileNames(ctx)
    const syncedActive = syncActiveRuleFilesToOrder(activeNames, safeNames)

    const settings = loadSettings(ctx)
    settings.ruleFileOrder = safeNames
    settings.activeRuleFiles = syncedActive
    saveSettings(ctx, settings)
    ctx.reloadAllRuleFiles()
    return safeNames
}

export interface RuleFileInfo {
    name: string
    enabled: boolean
    /** Issue #137: locked rulesets reject every write from CLI / MCP / API. */
    readonly: boolean
    ruleCount: number
    excludeCount: number
}

export function getActiveRuleFileNames(ctx: ServerContext): string[] {
    return getActiveFileNames(ctx)
}

export function readRuleFileContent(ctx: ServerContext, name: string): string {
    ensureRulesDir(ctx)
    const safeName = normalizeRuleFileName(name)
    const filePath = ruleFilePath(ctx, safeName)
    if (!fs.existsSync(filePath)) {
        throw new Error(`规则文件 "${safeName}" 不存在`)
    }
    return fs.readFileSync(filePath, 'utf8')
}

export function writeRuleFileContent(ctx: ServerContext, name: string, content: string): void {
    ensureRulesDir(ctx)
    const safeName = normalizeRuleFileName(name)
    const filePath = ruleFilePath(ctx, safeName)
    if (!fs.existsSync(filePath)) {
        throw ruleFileNotFound(safeName)
    }
    assertRuleFileWritable(ctx, safeName)
    fs.writeFileSync(filePath, content, 'utf8')
    ctx.reloadAllRuleFiles()
}

export function createRuleFile(ctx: ServerContext, name: string, content = '', enabled = true): RuleFileInfo {
    ensureRulesDir(ctx)
    const safeName = normalizeRuleFileName(name)
    const filePath = ruleFilePath(ctx, safeName)
    if (fs.existsSync(filePath)) {
        throw new Error(`规则文件 "${safeName}" 已存在`)
    }

    // Drop stale lock entries first so a new file never inherits an old lock.
    getReadonlyRuleFileNames(ctx)
    fs.writeFileSync(filePath, content, 'utf8')
    ensureRuleFileInOrder(ctx, safeName)

    if (enabled) {
        const activeNames = getActiveFileNames(ctx)
        if (!activeNames.includes(safeName)) {
            const fileOrder = resolveRuleFileOrder(readDiskRuleFileNames(ctx), getStoredRuleFileOrder(ctx), activeNames)
            setActiveFileNames(ctx, syncActiveRuleFilesToOrder([...activeNames, safeName], fileOrder))
        }
    }

    ctx.reloadAllRuleFiles()
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    return {
        name: safeName,
        enabled,
        readonly: false,
        ruleCount: Object.keys(ruleMap).length,
        excludeCount: Object.values(excludeMap).reduce((total, exclusions) => total + exclusions.length, 0),
    }
}

export function setActiveRuleFileNames(ctx: ServerContext, names: string[]): string[] {
    ensureRulesDir(ctx)
    const safeNames = names.map((name) => normalizeRuleFileName(name))
    const missingNames = safeNames.filter((name) => !fs.existsSync(ruleFilePath(ctx, name)))
    if (missingNames.length > 0) {
        throw new Error(`规则文件不存在: ${missingNames.join(', ')}`)
    }

    // A locked ruleset may not be switched on or off.
    const previous = new Set(getActiveFileNames(ctx))
    const next = new Set(safeNames)
    const changed = [...previous].filter((name) => !next.has(name)).concat(safeNames.filter((name) => !previous.has(name)))
    assertRuleFilesWritable(ctx, changed)

    setActiveFileNames(ctx, safeNames)

    // Keep tab order's enabled-file relative positions aligned with activeRuleFiles
    const diskNames = readDiskRuleFileNames(ctx)
    const currentOrder = resolveRuleFileOrder(diskNames, getStoredRuleFileOrder(ctx), safeNames)
    const activeSet = new Set(safeNames)
    let activeIndex = 0
    const nextOrder = currentOrder.map((name) => {
        if (!activeSet.has(name)) return name
        const replacement = safeNames[activeIndex]
        activeIndex += 1
        return replacement
    })
    while (activeIndex < safeNames.length) {
        nextOrder.push(safeNames[activeIndex])
        activeIndex += 1
    }
    // Deduplicate while preserving first occurrence
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const name of nextOrder) {
        if (seen.has(name)) continue
        deduped.push(name)
        seen.add(name)
    }
    for (const name of diskNames) {
        if (!seen.has(name)) {
            deduped.push(name)
            seen.add(name)
        }
    }
    setStoredRuleFileOrder(ctx, deduped)

    ctx.reloadAllRuleFiles()
    return safeNames
}

/**
 * Scan the route-rules directory and return file info list.
 */
export function listRuleFiles(ctx: ServerContext): RuleFileInfo[] {
    ensureRulesDir(ctx)
    const activeNames = getActiveFileNames(ctx)
    const files = readDiskRuleFileNames(ctx)
    const orderedNames = resolveRuleFileOrder(files, getStoredRuleFileOrder(ctx), activeNames)
    const readonlyNames = new Set(getReadonlyRuleFileNames(ctx))

    // Persist seeded order and newly discovered / deleted names so tabs stay stable
    const stored = getStoredRuleFileOrder(ctx)
    const needsPersist =
        stored.length === 0
        || orderedNames.some((name) => !stored.includes(name))
        || stored.some((name) => !orderedNames.includes(name))
    if (needsPersist) {
        setStoredRuleFileOrder(ctx, orderedNames)
    }

    return orderedNames.map(name => {
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
            readonly: readonlyNames.has(name),
            ruleCount,
            excludeCount,
        }
    })
}

export interface RuleFileDetail extends RuleFileInfo {
    content: string
}

/** Detail of one ruleset (info + raw content). Read-only operation. */
export function getRuleFileDetail(ctx: ServerContext, name: string): RuleFileDetail {
    const content = readRuleFileContent(ctx, name)
    const safeName = normalizeRuleFileName(name)
    const info = listRuleFiles(ctx).find((file) => file.name === safeName)
    if (!info) throw new Error(`规则文件 "${safeName}" 不存在`)
    return { ...info, content }
}

function ruleFileNotFound(name: string): Error & { status: number } {
    return Object.assign(new Error(`规则文件 "${name}" 不存在`), { status: 404 })
}

/**
 * Enable / disable and / or rename a ruleset. A locked ruleset is rejected
 * before anything changes (the web UI must unlock it first).
 */
export function updateRuleFile(ctx: ServerContext, rawName: string, changes: { enabled?: boolean; newName?: string }): { name: string } {
    const name = normalizeRuleFileName(rawName)
    const filePath = ruleFilePath(ctx, name)
    if (!fs.existsSync(filePath)) throw ruleFileNotFound(name)
    assertRuleFileWritable(ctx, name)

    const { enabled, newName } = changes
    let currentName = name
    const activeNames = getActiveFileNames(ctx)

    if (newName && newName.trim() && newName.trim() !== name) {
        const safeName = normalizeRuleFileName(newName)
        const newPath = ruleFilePath(ctx, safeName)
        if (fs.existsSync(newPath)) {
            throw Object.assign(new Error(`规则文件 "${safeName}" 已存在`), { status: 409 })
        }
        // Drop stale lock entries so the new name does not inherit an old lock.
        getReadonlyRuleFileNames(ctx)
        fs.renameSync(filePath, newPath)
        const idx = activeNames.indexOf(name)
        if (idx !== -1) activeNames[idx] = safeName
        currentName = safeName
        renameRuleFileInOrder(ctx, name, safeName)
    }

    if (enabled !== undefined) {
        const idx = activeNames.indexOf(currentName)
        if (enabled && idx === -1) {
            activeNames.push(currentName)
        } else if (!enabled && idx !== -1) {
            activeNames.splice(idx, 1)
        }
    }

    const fileOrder = resolveRuleFileOrder(
        readDiskRuleFileNames(ctx),
        getStoredRuleFileOrder(ctx),
        activeNames,
    )
    setActiveFileNames(ctx, syncActiveRuleFilesToOrder(activeNames, fileOrder))
    ctx.reloadAllRuleFiles()
    return { name: currentName }
}

/** Delete a ruleset. A locked ruleset is rejected and stays on disk. */
export function deleteRuleFile(ctx: ServerContext, rawName: string): void {
    const name = normalizeRuleFileName(rawName)
    const filePath = ruleFilePath(ctx, name)
    if (!fs.existsSync(filePath)) throw ruleFileNotFound(name)
    assertRuleFileWritable(ctx, name)

    fs.unlinkSync(filePath)
    const activeNames = getActiveFileNames(ctx)
    const idx = activeNames.indexOf(name)
    if (idx !== -1) {
        activeNames.splice(idx, 1)
        setActiveFileNames(ctx, activeNames)
    }
    removeRuleFileFromOrder(ctx, name)
    ctx.reloadAllRuleFiles()
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

export interface RuleOverviewEntry {
    pattern: string
    target: string
    rawRule: string
    rawTarget: string
    exclusions: string[]
    enabled: boolean
}

export interface RuleOverviewFile {
    name: string
    enabled: boolean
    rules: RuleOverviewEntry[]
    error?: string
}

export interface RuleOverviewMergedRule {
    pattern: string
    target: string
    rawRule: string
    rawTarget: string
    exclusions: string[]
    file: string
}

export interface RuleOverviewConflictRecord {
    file: string
    target: string
    rawRule: string
    rawTarget: string
}

export interface RuleOverviewConflict {
    pattern: string
    winner: RuleOverviewConflictRecord
    shadowed: RuleOverviewConflictRecord[]
}

export interface RuleOverview {
    files: RuleFileInfo[]
    mergedRules: RuleOverviewMergedRule[]
    conflicts: RuleOverviewConflict[]
    perFileRules: RuleOverviewFile[]
}

/**
 * 全局规则总览数据：合并语义与 mergeActiveRules / routeRulesToLegacyMaps 保持一致——
 * 同 pattern 后定义覆盖先定义（last-write-wins），匹配位置取首次出现顺序。
 */
export function buildRuleOverview(ctx: ServerContext): RuleOverview {
    const files = listRuleFiles(ctx)
    const activeNames = getActiveFileNames(ctx)

    const perFileRules: RuleOverviewFile[] = files.map((file) => {
        try {
            const content = fs.readFileSync(ruleFilePath(ctx, file.name), 'utf8')
            const { rules } = parseEprcWithExclusions(content, { includeDisabled: true })
            return {
                name: file.name,
                enabled: file.enabled,
                rules: rules.map((entry) => ({
                    pattern: entry.pattern,
                    target: entry.target,
                    rawRule: entry.rawRule ?? entry.pattern,
                    rawTarget: entry.rawTarget ?? entry.target,
                    exclusions: entry.exclusions.slice(),
                    enabled: entry.enabled !== false,
                })),
            }
        } catch (err) {
            return { name: file.name, enabled: file.enabled, rules: [], error: (err as Error).message }
        }
    })

    // 仅启用文件的启用规则参与合并，顺序 = activeRuleFiles 顺序 + 文件内行序
    const definitions = new Map<string, Array<{ file: string; target: string; rawRule: string; rawTarget: string; exclusions: string[] }>>()
    const firstSeenOrder: string[] = []
    for (const name of activeNames) {
        const overview = perFileRules.find((file) => file.name === name)
        if (!overview || overview.error) continue
        for (const entry of overview.rules) {
            if (!entry.enabled) continue
            const record = {
                file: name,
                target: entry.target,
                rawRule: entry.rawRule,
                rawTarget: entry.rawTarget,
                exclusions: entry.exclusions.slice(),
            }
            if (!definitions.has(entry.pattern)) {
                definitions.set(entry.pattern, [record])
                firstSeenOrder.push(entry.pattern)
            } else {
                definitions.get(entry.pattern)!.push(record)
            }
        }
    }

    const mergedRules: RuleOverviewMergedRule[] = firstSeenOrder.map((pattern) => {
        const records = definitions.get(pattern)!
        const winner = records[records.length - 1]
        return {
            pattern,
            target: winner.target,
            rawRule: winner.rawRule,
            rawTarget: winner.rawTarget,
            exclusions: winner.exclusions,
            file: winner.file,
        }
    })

    const conflicts: RuleOverviewConflict[] = []
    for (const pattern of firstSeenOrder) {
        const records = definitions.get(pattern)!
        if (records.length > 1) {
            const toRecord = (record: { file: string; target: string; rawRule: string; rawTarget: string }): RuleOverviewConflictRecord => ({
                file: record.file,
                target: record.target,
                rawRule: record.rawRule,
                rawTarget: record.rawTarget,
            })
            const winner = records[records.length - 1]
            conflicts.push({
                pattern,
                winner: toRecord(winner),
                shadowed: records.slice(0, -1).map(toRecord),
            })
        }
    }

    return { files, mergedRules, conflicts, perFileRules }
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
    const allFiles = readDiskRuleFileNames(ctx)
    if (activeNames.length === 0) {
        if (allFiles.length > 0) {
            activeNames = [allFiles[0]]
            setActiveFileNames(ctx, activeNames)
        }
    }

    const ordered = resolveRuleFileOrder(allFiles, getStoredRuleFileOrder(ctx), activeNames)
    if (getStoredRuleFileOrder(ctx).length === 0 && ordered.length > 0) {
        setStoredRuleFileOrder(ctx, ordered)
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

    // GET /api/rule-files/overview - 全局规则总览（合并语义与代理实际路由一致）
    app.get('/api/rule-files/overview', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        res.write(JSON.stringify(buildRuleOverview(ctx)))
        res.end()
    })

    // PUT /api/rule-files/order - 持久化 Tab / 文件顺序，并同步启用文件合并顺序
    app.put('/api/rule-files/order', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const order = req.body?.order
            if (!Array.isArray(order) || order.some((name: unknown) => typeof name !== 'string')) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '缺少有效的 order 数组' }))
                res.end()
                return
            }
            const nextOrder = setRuleFileOrder(ctx, order)
            res.write(JSON.stringify({ status: 'success', order: nextOrder }))
        } catch (err) {
            res.statusCode = 400
            res.write(JSON.stringify({ error: (err as Error).message }))
        }
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

            const ruleFile = createRuleFile(ctx, name, content, enabled !== false)
            res.write(JSON.stringify({ status: 'success', ruleFile: { name: ruleFile.name, enabled: ruleFile.enabled, ruleCount: ruleFile.ruleCount } }))
        } catch (err) {
            const message = (err as Error).message
            if (message.includes('已存在')) {
                res.statusCode = 409
            } else {
                res.statusCode = 500
            }
            res.write(JSON.stringify({ error: message }))
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
        res.setHeader('X-Meddle-Ruleset-Readonly', isRuleFileReadonly(ctx, name) ? 'true' : 'false')
        res.write(fs.readFileSync(filePath, 'utf8'))
        res.end()
    })

    // GET /api/rule-files/:name - 规则集详情（含 readonly 与内容）
    app.get('/api/rule-files/:name', (req: Request, res: Response) => {
        const name = decodeURIComponent(req.params.name as string)
        if (!fs.existsSync(ruleFilePath(ctx, name))) {
            sendJson(res, 404, { error: '规则文件不存在' })
            return
        }
        try {
            sendJson(res, 200, getRuleFileDetail(ctx, name))
        } catch (err) {
            sendError(res, err)
        }
    })

    // PUT /api/rule-files/:name/content - 保存规则文件内容（锁住时拒绝）
    app.put('/api/rule-files/:name/content', (req: Request, res: Response) => {
        const name = decodeURIComponent(req.params.name as string)
        try {
            const text = typeof req.body === 'string' ? req.body : (req.body?.content ?? '')
            writeRuleFileContent(ctx, name, text)
            sendJson(res, 200, { status: 'success' })
        } catch (err) {
            sendError(res, err)
        }
    })

    // PUT /api/rule-files/:name/readonly - 加锁 / 解锁（仅 Web 界面：页面令牌 + 同源）
    app.put('/api/rule-files/:name/readonly', (req: Request, res: Response) => {
        const rawName = decodeURIComponent(req.params.name as string)
        if (!isSameOriginRequest(req)) {
            sendJson(res, 403, { error: '只能在 Meddle 界面中加锁或解锁', code: 'UI_ORIGIN_REQUIRED' })
            return
        }
        if (!hasValidUiToken(req, ctx)) {
            sendJson(res, 403, { error: '界面令牌无效，请刷新 Meddle 页面后重试', code: 'UI_TOKEN_INVALID' })
            return
        }
        const readonly = req.body?.readonly
        if (typeof readonly !== 'boolean') {
            sendJson(res, 400, { error: '缺少 readonly 布尔值' })
            return
        }
        try {
            const name = normalizeRuleFileName(rawName)
            if (!fs.existsSync(ruleFilePath(ctx, name))) throw ruleFileNotFound(name)
            setRuleFileReadonly(ctx, name, readonly)
            sendJson(res, 200, { status: 'success', name, readonly })
        } catch (err) {
            sendError(res, err)
        }
    })

    // PUT /api/rule-files/:name - 更新规则文件属性（启用/禁用、重命名；锁住时拒绝）
    app.put('/api/rule-files/:name', (req: Request, res: Response) => {
        const name = decodeURIComponent(req.params.name as string)
        try {
            const { enabled, newName } = req.body || {}
            const result = updateRuleFile(ctx, name, { enabled, newName })
            sendJson(res, 200, { status: 'success', name: result.name })
        } catch (err) {
            sendError(res, err)
        }
    })

    // DELETE /api/rule-files/:name - 删除规则文件（锁住时拒绝）
    app.delete('/api/rule-files/:name', (req: Request, res: Response) => {
        const name = decodeURIComponent(req.params.name as string)
        try {
            deleteRuleFile(ctx, name)
            sendJson(res, 200, { status: 'success' })
        } catch (err) {
            sendError(res, err)
        }
    })
}

function sendJson(res: Response, status: number, body: unknown): void {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.write(JSON.stringify(body))
    res.end()
}

function sendError(res: Response, err: unknown): void {
    if (isRulesetReadonlyError(err)) {
        sendJson(res, RULESET_READONLY_STATUS, rulesetReadonlyBody(err))
        return
    }
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500
    sendJson(res, status, { error: (err as Error).message })
}

/** Page bootstrap for the UI token (fallback when index.html was not served by Meddle, e.g. Vite dev). */
export function registerUiTokenRoute(app: Application, ctx: ServerContext): void {
    app.get('/api/ui-token', (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store')
        if (!isSameOriginRequest(req)) {
            sendJson(res, 403, { error: '只能在 Meddle 界面中获取', code: 'UI_ORIGIN_REQUIRED' })
            return
        }
        sendJson(res, 200, { token: getUiToken(ctx) })
    })
}

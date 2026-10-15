import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import { ServerContext } from './index'
import {
    assertRuleFilesWritable,
    isRulesetReadonlyError,
    normalizeReadonlyNames,
    READONLY_SETTINGS_KEY,
    rulesetReadonlyBody,
    RULESET_READONLY_STATUS,
} from './ruleset-lock'

/**
 * Issue #137: the settings endpoints must not become a side door around the
 * ruleset lock. `readonlyRuleFiles` can only change through the UI lock route,
 * and `activeRuleFiles` may not switch a locked ruleset on or off.
 */
function guardRulesetLockFields(ctx: ServerContext, current: Record<string, unknown>, next: Record<string, unknown>): void {
    const currentLocked = normalizeReadonlyNames(current[READONLY_SETTINGS_KEY])
    if (READONLY_SETTINGS_KEY in next) {
        const incoming = normalizeReadonlyNames(next[READONLY_SETTINGS_KEY])
        const same = incoming.length === currentLocked.length && incoming.every((name) => currentLocked.includes(name))
        if (!same) {
            throw Object.assign(new Error('规则集只读锁只能在 Meddle 界面中修改'), { status: 403, code: 'RULESET_LOCK_UI_ONLY' })
        }
    }
    if (READONLY_SETTINGS_KEY in current) next[READONLY_SETTINGS_KEY] = current[READONLY_SETTINGS_KEY]
    else delete next[READONLY_SETTINGS_KEY]

    if ('activeRuleFiles' in next && currentLocked.length > 0) {
        const before = new Set(Array.isArray(current.activeRuleFiles) ? current.activeRuleFiles as string[] : [])
        const after = new Set(Array.isArray(next.activeRuleFiles) ? next.activeRuleFiles as string[] : [])
        const changed = [...before].filter((name) => !after.has(name)).concat([...after].filter((name) => !before.has(name)))
        assertRuleFilesWritable(ctx, changed)
    }
}

function readCurrentSettings(ctx: ServerContext): Record<string, unknown> {
    if (!fs.existsSync(ctx.settingsPath)) return {}
    return JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
}

function sendSettingsError(res: Response, error: unknown): void {
    if (isRulesetReadonlyError(error)) {
        res.statusCode = RULESET_READONLY_STATUS
        res.write(JSON.stringify(rulesetReadonlyBody(error)))
        return
    }
    const status = (error as { status?: number }).status
    const code = (error as { code?: string }).code
    res.statusCode = typeof status === 'number' ? status : 500
    res.write(JSON.stringify(code ? { error: (error as Error).message, code } : { error: (error as Error).message }))
}

/**
 * Re-resolve the mocks file from settings and load it (issue #118). When the
 * path changed, the mock handler also moves its file watcher and starts the
 * id counter from the new file; later saves go to the new file. The old file
 * is never modified or deleted.
 */
function reloadMocksFromSettings(ctx: ServerContext): void {
    ctx.currentMocksPath = null
    ctx.loadMockRules()
    ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
}

export function refreshConfig(ctx: ServerContext): { status: string; message: string; mocksPath: string; mocksParseError?: unknown } {
    ctx.reloadAllRuleFiles()

    reloadMocksFromSettings(ctx)

    // Issue #120: surface a broken mocks file instead of reporting a silent empty list.
    const parseError = ctx.getMocksParseError?.() || null
    return {
        status: 'success',
        message: parseError ? '配置已刷新（Mock 文件格式错误，未加载规则）' : '配置已刷新',
        mocksPath: ctx.getMockFilePath(),
        ...(parseError ? { mocksParseError: parseError } : {}),
    }
}

export function registerConfigRoutes(app: Application, ctx: ServerContext): void {
    app.get('/api/remote-access', (_req: Request, res: Response) => {
        res.json(ctx.getRemoteAccessInfo())
    })

    // API: 刷新配置
    app.post('/api/refresh-config', async (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            res.write(JSON.stringify(refreshConfig(ctx)))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: 获取系统设置
    app.get('/api/settings', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            if (fs.existsSync(ctx.settingsPath)) {
                const settingsData = fs.readFileSync(ctx.settingsPath, 'utf8')
                res.write(settingsData)
            } else {
                res.write(JSON.stringify({
                    theme: 'system',
                    accentColor: 'auto',
                    fontSize: 'medium',
                    detailBodySizeKB: 256,
                    aiConfig: {
                        enabled: false,
                        provider: 'openai',
                        apiKey: '',
                        baseUrl: '',
                        model: '',
                        models: []
                    }
                }))
            }
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    function writeSettingsAndApply(settings: Record<string, unknown>): void {
        const previousMocksPath = ctx.getMockFilePath()
        const tmp = `${ctx.settingsPath}.${process.pid}.${Date.now()}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
        fs.renameSync(tmp, ctx.settingsPath)
        ctx.refreshClientAliases()
        // Issue #118: a changed mocksFilePath takes effect right away (no
        // restart / refresh needed). Unrelated settings saves leave the
        // loaded mocks alone.
        ctx.currentMocksPath = null
        if (ctx.getMockFilePath() !== previousMocksPath) reloadMocksFromSettings(ctx)
    }

    // API: 保存系统设置（整份替换；旧客户端 / 迁移使用）
    app.post('/api/settings', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const next = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : req.body
            if (next && typeof next === 'object' && !Array.isArray(next)) {
                guardRulesetLockFields(ctx, readCurrentSettings(ctx), next)
            }
            writeSettingsAndApply(next)
            res.write(JSON.stringify({ status: 'success', message: '设置已保存' }))
        } catch (error) {
            sendSettingsError(res, error)
        }
        res.end()
    })

    // API: 只更新提交的字段（issue #121）。旧标签页保存某一项设置时，
    // 不会把别处改过的字段（如 mocksFilePath）改回它手里的旧值。
    app.patch('/api/settings', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const updates = req.body
            if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '设置更新必须是 JSON 对象' }))
                res.end()
                return
            }
            const current = readCurrentSettings(ctx)
            const merged = { ...current, ...updates }
            guardRulesetLockFields(ctx, current, merged)
            writeSettingsAndApply(merged)
            res.write(JSON.stringify({ status: 'success', message: '设置已保存', settings: merged }))
        } catch (error) {
            sendSettingsError(res, error)
        }
        res.end()
    })

    // API: 配置文件健康检查
    app.get('/api/config-doctor', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const result = ctx.performConfigDiagnostics()
            res.write(JSON.stringify(result))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })
}

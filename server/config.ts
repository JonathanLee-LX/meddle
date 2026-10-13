import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import { ServerContext } from './index'

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
            writeSettingsAndApply(req.body)
            res.write(JSON.stringify({ status: 'success', message: '设置已保存' }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
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
            let current: Record<string, unknown> = {}
            if (fs.existsSync(ctx.settingsPath)) {
                current = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
            }
            const merged = { ...current, ...updates }
            writeSettingsAndApply(merged)
            res.write(JSON.stringify({ status: 'success', message: '设置已保存', settings: merged }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
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

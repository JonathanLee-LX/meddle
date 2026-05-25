import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import { ServerContext } from './index'

export function refreshConfig(ctx: ServerContext): { status: string; message: string; mocksPath: string } {
    ctx.reloadAllRuleFiles()

    ctx.currentMocksPath = null
    ctx.loadMockRules()

    return {
        status: 'success',
        message: '配置已刷新',
        mocksPath: ctx.getMockFilePath(),
    }
}

export function registerConfigRoutes(app: Application, ctx: ServerContext): void {
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
                    fontSize: 'medium',
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

    // API: 保存系统设置
    app.post('/api/settings', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const settings = req.body
            fs.writeFileSync(ctx.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
            res.write(JSON.stringify({ status: 'success', message: '设置已保存' }))
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

import { Application, Request, Response } from 'express'
import { ServerContext } from './index'
import { ruleMapToEprcText } from '../helpers'
import { previewRouteTarget } from '../core/route-preview'

export function registerRulesRoutes(app: Application, ctx: ServerContext): void {
    app.get('/api/rules', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.write(ruleMapToEprcText(ctx.ruleMap))
        res.end()
    })

    app.post('/api/rules/preview', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')

        try {
            const { url, rulesText } = req.body || {}
            if (typeof url !== 'string' || !url.trim()) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '缺少待预览的 URL' }))
                res.end()
                return
            }

            if (typeof rulesText !== 'string') {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '缺少规则文本' }))
                res.end()
                return
            }

            const result = previewRouteTarget(url.trim(), rulesText)
            res.write(JSON.stringify({ status: 'success', ...result }))
        } catch (err) {
            const message = err instanceof Error ? err.message : '预览失败'
            res.statusCode = message.includes('URL') || message.includes('正则表达式') ? 400 : 500
            res.write(JSON.stringify({ error: message }))
        }

        res.end()
    })
}

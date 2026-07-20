import { Application, Request, Response } from 'express'
import { ServerContext } from './index'

export function registerLogsRoutes(app: Application, ctx: ServerContext): void {
    // API: /api/logs - List all logs
    app.get('/api/logs', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        // Sort logs by time - newest to oldest (reverse chronological order)
        res.write(JSON.stringify([...ctx.proxyRecordArr].reverse()))
        res.end()
    })

    // API: /api/logs/:id - Get log detail by ID
    app.get('/api/logs/:id', (req: Request, res: Response) => {
        const id = parseInt(req.params.id as string, 10)
        const detail = ctx.proxyRecordDetailMap.get(id)
        const record = ctx.proxyRecordArr.find((item) => item.id === id)
        res.setHeader('Content-Type', 'application/json')
        if (detail) {
            res.write(JSON.stringify(detail))
        } else if (record) {
            res.write(JSON.stringify({
                requestHeaders: {},
                requestBody: '',
                responseHeaders: {},
                responseBody: '',
                statusCode: record.statusCode ?? 0,
                statusMessage: '',
                method: record.method,
                url: record.source,
            }))
        } else {
            res.statusCode = 404
            res.write(JSON.stringify({ error: 'Not found' }))
        }
        res.end()
    })
}

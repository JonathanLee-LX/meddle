import { Application, Request, Response } from 'express'
import { ServerContext } from './index'

function setMockJsonHeaders(res: Response): void {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
}

export function registerMocksRoutes(app: Application, ctx: ServerContext): void {
    // API: /api/mocks - GET (list), POST (create)
    app.route('/api/mocks')
        .get((_req: Request, res: Response) => {
            setMockJsonHeaders(res)
            res.write(JSON.stringify(ctx.mockRules))
            res.end()
        })
        .post((req: Request, res: Response) => {
            setMockJsonHeaders(res)
            try {
                const data = req.body
                const rule = {
                    id: ctx.mockIdSeq++,
                    name: data.name || '',
                    urlPattern: data.urlPattern || '',
                    method: data.method || '*',
                    statusCode: data.statusCode || 200,
                    delay: data.delay || 0,
                    bodyType: data.bodyType || 'inline',
                    headers: data.headers || {},
                    body: data.body || '',
                    enabled: data.enabled !== false
                }
                ctx.mockRules.push(rule)
                ctx.saveMockRules()
                ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
                res.write(JSON.stringify({ status: 'success', rule }))
            } catch (err) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: (err as Error).message }))
            }
            res.end()
        })

    // API: /api/mocks/:id - DELETE, PUT
    app.all('/api/mocks/:id', (req: Request, res: Response) => {
        const id = parseInt(req.params.id as string, 10)
        const method = req.method.toUpperCase()

        // DELETE /api/mocks/:id
        if (method === 'DELETE') {
            setMockJsonHeaders(res)
            const idx = ctx.mockRules.findIndex(r => r.id === id)
            if (idx !== -1) {
                ctx.mockRules.splice(idx, 1)
                ctx.saveMockRules()
                ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
                res.write(JSON.stringify({ status: 'success' }))
            } else {
                res.statusCode = 404
                res.write(JSON.stringify({ error: 'Not found' }))
            }
            res.end()
            return
        }

        // PUT /api/mocks/:id - 更新规则
        if (method === 'PUT') {
            setMockJsonHeaders(res)
            try {
                const data = req.body
                const idx = ctx.mockRules.findIndex(r => r.id === id)
                if (idx === -1) {
                    res.statusCode = 404
                    res.write(JSON.stringify({ error: 'Not found' }))
                } else {
                    ctx.mockRules[idx] = { ...ctx.mockRules[idx], ...data, id }
                    ctx.saveMockRules()
                    ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
                    res.write(JSON.stringify({ status: 'success', rule: ctx.mockRules[idx] }))
                }
            } catch (err) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: (err as Error).message }))
            }
            res.end()
            return
        }
    })
}

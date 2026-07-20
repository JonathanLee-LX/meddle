import { Application, Request, Response } from 'express'
import { ServerContext } from './index'

function setMockJsonHeaders(res: Response): void {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
}

export type MockRule = ServerContext['mockRules'][number]
export type MockRuleInput = Partial<Omit<MockRule, 'id'>>

function persistMockRules(ctx: ServerContext): void {
    ctx.saveMockRules()
    ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
}

export function createMockRule(ctx: ServerContext, data: MockRuleInput): MockRule {
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
    persistMockRules(ctx)
    return rule
}

export function updateMockRule(ctx: ServerContext, id: number, data: MockRuleInput): MockRule {
    const idx = ctx.mockRules.findIndex(r => r.id === id)
    if (idx === -1) {
        throw new Error('Not found')
    }

    ctx.mockRules[idx] = { ...ctx.mockRules[idx], ...data, id }
    persistMockRules(ctx)
    return ctx.mockRules[idx]
}

export function deleteMockRule(ctx: ServerContext, id: number): void {
    const idx = ctx.mockRules.findIndex(r => r.id === id)
    if (idx === -1) {
        throw new Error('Not found')
    }

    ctx.mockRules.splice(idx, 1)
    persistMockRules(ctx)
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
                const rule = createMockRule(ctx, req.body)
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
            try {
                deleteMockRule(ctx, id)
                res.write(JSON.stringify({ status: 'success' }))
            } catch {
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
                const rule = updateMockRule(ctx, id, req.body)
                res.write(JSON.stringify({ status: 'success', rule }))
            } catch (err) {
                res.statusCode = (err as Error).message === 'Not found' ? 404 : 400
                res.write(JSON.stringify({ error: (err as Error).message }))
            }
            res.end()
            return
        }
    })
}

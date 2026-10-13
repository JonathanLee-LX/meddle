import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { ServerContext } from './index'
import { nextMockRuleId } from '../core/mock-utils'

function setMockJsonHeaders(res: Response): void {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
}

export type MockRule = ServerContext['mockRules'][number]
export type MockRuleInput = Partial<Omit<MockRule, 'id'>>

/** Issue #120: refuse before mutating memory, so a rejected write changes nothing. */
function assertWritable(ctx: ServerContext): void {
    ctx.assertMocksWritable?.()
}

function isInvalidFileError(err: unknown): boolean {
    return (err as { code?: string })?.code === 'MOCKS_FILE_INVALID'
}

function writeError(res: Response, err: unknown, fallbackStatus: number): void {
    const e = err as Error & { parseError?: unknown; filePath?: string }
    if (isInvalidFileError(err)) {
        res.statusCode = 409
        res.write(JSON.stringify({ error: e.message, code: 'MOCKS_FILE_INVALID', path: e.filePath, parseError: e.parseError }))
        return
    }
    res.statusCode = e.message === 'Not found' ? 404 : fallbackStatus
    res.write(JSON.stringify({ error: e.message }))
}

function persistMockRules(ctx: ServerContext, snapshot: { rules: MockRule[]; seq: number }): void {
    try {
        ctx.saveMockRules()
    } catch (err) {
        // Roll memory back so it keeps matching the (unchanged) file.
        ctx.mockRules = snapshot.rules
        ctx.mockIdSeq = snapshot.seq
        throw err
    }
    ctx.broadcastToAllClients({ type: 'mocksUpdated', rules: ctx.mockRules })
}

export function createMockRule(ctx: ServerContext, data: MockRuleInput): MockRule {
    // Issue #115: derive the id from both the sequence and the rules actually
    // present, so a stale sequence can never reuse an existing id. Any
    // client-supplied `id` in `data` is ignored — create never overwrites.
    assertWritable(ctx)
    const snapshot = { rules: structuredClone(ctx.mockRules), seq: ctx.mockIdSeq }
    const id = nextMockRuleId(ctx.mockRules, ctx.mockIdSeq)
    ctx.mockIdSeq = id + 1
    const rule = {
        id,
        name: data.name || '',
        urlPattern: data.urlPattern || '',
        query: data.query || '',
        method: data.method || '*',
        statusCode: data.statusCode || 200,
        delay: data.delay || 0,
        bodyType: data.bodyType || 'inline',
        headers: data.headers || {},
        body: data.body || '',
        enabled: data.enabled !== false
    }
    ctx.mockRules.push(rule)
    persistMockRules(ctx, snapshot)
    return rule
}

export function updateMockRule(ctx: ServerContext, id: number, data: MockRuleInput): MockRule {
    assertWritable(ctx)
    const snapshot = { rules: structuredClone(ctx.mockRules), seq: ctx.mockIdSeq }
    const idx = ctx.mockRules.findIndex(r => r.id === id)
    if (idx === -1) {
        throw new Error('Not found')
    }

    ctx.mockRules[idx] = { ...ctx.mockRules[idx], ...data, id }
    persistMockRules(ctx, snapshot)
    return ctx.mockRules[idx]
}

export function deleteMockRule(ctx: ServerContext, id: number): void {
    assertWritable(ctx)
    const snapshot = { rules: structuredClone(ctx.mockRules), seq: ctx.mockIdSeq }
    const idx = ctx.mockRules.findIndex(r => r.id === id)
    if (idx === -1) {
        throw new Error('Not found')
    }

    ctx.mockRules.splice(idx, 1)
    persistMockRules(ctx, snapshot)
}

export interface MocksFileStatus {
    /** Absolute path of the mocks file the proxy currently reads and writes. */
    path: string
    /** False until the first save creates a configured file that does not exist yet (issue #118). */
    exists: boolean
    /**
     * True when a custom `mocksFilePath` is in effect (anything other than the
     * default `<MEDDLE_HOME>/mocks.json`). The UI only warns about a missing
     * file when it is custom — same rule as the server-side startup warning.
     */
    custom: boolean
    /** Issue #120: false when the file exists but is not valid JSON; every write is then refused. */
    valid: boolean
    /** Parse failure (1-based line/column) when `valid` is false, else null. */
    parseError: { line: number | null; column: number | null; message: string } | null
    /** Full human-readable error (path + position) when `valid` is false. */
    error?: string
}

export function getMocksFileStatus(ctx: ServerContext): MocksFileStatus {
    const file = path.resolve(ctx.getMockFilePath())
    let exists = false
    try {
        exists = fs.statSync(file).isFile()
    } catch (_) { /* missing */ }
    const custom = file !== path.resolve(ctx.meddleDir, 'mocks.json')
    const parseError = (exists && ctx.getMocksParseError?.()) || null
    const status: MocksFileStatus = { path: file, exists, custom, valid: !parseError, parseError }
    if (parseError) {
        const loc = parseError.line != null ? `第 ${parseError.line} 行第 ${parseError.column} 列：` : ''
        status.error = `Mock 文件格式错误: ${file} ${loc}${parseError.message}`
    }
    return status
}

export function registerMocksRoutes(app: Application, ctx: ServerContext): void {
    // API: /api/mocks-file - GET status of the active mocks file (issue #118).
    // Separate endpoint so GET /api/mocks keeps returning a bare array
    // (MCP / CLI / older web builds depend on that shape).
    app.get('/api/mocks-file', (_req: Request, res: Response) => {
        setMockJsonHeaders(res)
        res.write(JSON.stringify(getMocksFileStatus(ctx)))
        res.end()
    })

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
                writeError(res, err, 400)
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
            } catch (err) {
                writeError(res, err, 404)
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
                writeError(res, err, 400)
            }
            res.end()
            return
        }
    })
}

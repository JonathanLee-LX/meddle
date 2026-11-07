import type { Application } from 'express'

/** Shared with PUT /api/rule-files/:name/content. */
export const INVALID_JSON_BODY = '请求体不是合法的 JSON'

export function isJsonParseFailure(err: any): boolean {
    if (!err) return false
    const status = err.status || err.statusCode
    if (status !== 400) return false
    return err.type === 'entity.parse.failed' || err instanceof SyntaxError
}

/** express.json() otherwise answers with an HTML 400 that includes absolute paths. */
export function registerJsonParseErrorHandler(app: Application): void {
    app.use((err: any, _req: any, res: any, next: (error?: unknown) => void) => {
        if (!isJsonParseFailure(err) || res.headersSent) {
            next(err)
            return
        }
        res.status(400)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: INVALID_JSON_BODY }))
    })
}

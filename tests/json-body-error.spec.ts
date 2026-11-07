import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { registerMocksRoutes } from '../server/mocks'
import { INVALID_JSON_BODY, registerJsonParseErrorHandler } from '../server/json-parse-error'

/**
 * Issue #157: illegal JSON on APIs other than PUT rule-file content used to
 * return an HTML 400 whose stack included absolute server paths.
 */

const servers: import('node:http').Server[] = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        if (server.listening) server.close(() => resolve())
        else resolve()
    })))
})

async function listen(app: express.Express): Promise<number> {
    const server = app.listen(0, '127.0.0.1')
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    return (server.address() as AddressInfo).port
}

describe('illegal JSON request body (#157)', () => {
    it('POST /api/mocks with `{bad` returns 400 JSON and no HTML stack', async () => {
        const app = express()
        app.use(express.json({ limit: '50mb' }))
        registerMocksRoutes(app, { mockRules: [] } as any)
        registerJsonParseErrorHandler(app)

        const port = await listen(app)
        const res = await fetch(`http://127.0.0.1:${port}/api/mocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{bad',
        })
        const text = await res.text()
        expect(res.status).toBe(400)
        expect(res.headers.get('content-type')).toContain('application/json')
        expect(JSON.parse(text)).toEqual({ error: INVALID_JSON_BODY })
        expect(text).not.toContain('<')
        expect(text).not.toMatch(/\/(?:agent|Users|home|opt)\//)
        expect(text).not.toContain('SyntaxError')
    })
})

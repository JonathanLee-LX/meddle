import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    INVALID_RULE_CONTENT_FIELD,
    INVALID_RULE_CONTENT_JSON,
    registerRuleFilesRoutes,
} from '../server/rule-files'
import { RULESET_READONLY, RULESET_READONLY_STATUS } from '../server/ruleset-lock'

/**
 * PUT /api/rule-files/:name/content must not empty the rule file when the
 * body is not JSON or `content` is missing / not a string.
 */

const servers: import('node:http').Server[] = []
const homes: string[] = []
const ORIGINAL = 'a.com 10.0.0.1:8080\n# keep me\n'

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        if (server.listening) server.close(() => resolve())
        else resolve()
    })))
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function listen(app: express.Express): Promise<number> {
    const server = app.listen(0, '127.0.0.1')
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    return (server.address() as AddressInfo).port
}

function setup(settings: Record<string, unknown> = {}): { portPromise: Promise<number>; file: string } {
    const home = mkdtempSync(join(tmpdir(), 'meddle-rule-body-'))
    homes.push(home)
    const dir = join(home, 'route-rules')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'dev.txt')
    writeFileSync(file, ORIGINAL)
    writeFileSync(join(home, 'settings.json'), JSON.stringify(settings))
    const app = express()
    app.use(express.json({ limit: '50mb' }))
    app.use(express.urlencoded({ extended: true, limit: '50mb' }))
    registerRuleFilesRoutes(app, {
        meddleDir: home,
        settingsPath: join(home, 'settings.json'),
        reloadAllRuleFiles: () => {},
    } as any)
    return { portPromise: listen(app), file }
}

async function put(port: number, headers: Record<string, string> | undefined, body: string) {
    const res = await fetch(`http://127.0.0.1:${port}/api/rule-files/dev/content`, {
        method: 'PUT',
        headers,
        body,
    })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* html or empty */ }
    return { status: res.status, text, json, contentType: res.headers.get('content-type') }
}

describe('PUT /api/rule-files/:name/content invalid body', () => {
    it('non-JSON body returns 400 and leaves the file byte-for-byte unchanged', async () => {
        const { portPromise, file } = setup()
        const port = await portPromise
        const before = readFileSync(file)

        const invalidJson = await put(port, { 'Content-Type': 'application/json' }, '{not json')
        expect(invalidJson.status).toBe(400)
        expect(invalidJson.contentType).toContain('application/json')
        expect(invalidJson.json).toEqual({ error: INVALID_RULE_CONTENT_JSON })
        expect(readFileSync(file).equals(before)).toBe(true)

        const plain = await put(port, { 'Content-Type': 'text/plain' }, 'not json')
        expect(plain.status).toBe(400)
        expect(plain.json).toEqual({ error: INVALID_RULE_CONTENT_JSON })
        expect(readFileSync(file).equals(before)).toBe(true)

        const noType = await put(port, undefined, 'not json')
        expect(noType.status).toBe(400)
        expect(noType.json).toEqual({ error: INVALID_RULE_CONTENT_JSON })
        expect(readFileSync(file).equals(before)).toBe(true)
    })

    it('JSON without a string content field returns 400 and leaves the file unchanged', async () => {
        const { portPromise, file } = setup()
        const port = await portPromise
        const before = readFileSync(file)
        const bodies = ['{}', '{"name":"dev"}', '{"content":null}', '{"content":1}', '[]']
        for (const body of bodies) {
            const res = await put(port, { 'Content-Type': 'application/json' }, body)
            expect(res.status, body).toBe(400)
            expect(res.json, body).toEqual({ error: INVALID_RULE_CONTENT_FIELD })
            expect(readFileSync(file).equals(before), body).toBe(true)
        }
    })

    it('a valid content string, including empty, replaces the file', async () => {
        const { portPromise, file } = setup()
        const port = await portPromise
        const next = 'b.com 10.1.1.1:9\n# still here\n'
        const res = await put(
            port,
            { 'Content-Type': 'application/json' },
            JSON.stringify({ content: next }),
        )
        expect(res.status).toBe(200)
        expect(res.json).toEqual({ status: 'success' })
        expect(readFileSync(file, 'utf8')).toBe(next)

        const cleared = await put(
            port,
            { 'Content-Type': 'application/json' },
            JSON.stringify({ content: '' }),
        )
        expect(cleared.status).toBe(200)
        expect(cleared.json).toEqual({ status: 'success' })
        expect(readFileSync(file, 'utf8')).toBe('')
    })

    it('a locked ruleset rejects a valid body with 423 and an invalid body with 400', async () => {
        const { portPromise, file } = setup({ readonlyRuleFiles: ['dev'] })
        const port = await portPromise
        const before = readFileSync(file)

        const invalid = await put(port, { 'Content-Type': 'application/json' }, '{not json')
        expect(invalid.status).toBe(400)
        expect(invalid.json).toEqual({ error: INVALID_RULE_CONTENT_JSON })
        expect(readFileSync(file).equals(before)).toBe(true)

        const missing = await put(port, { 'Content-Type': 'application/json' }, '{}')
        expect(missing.status).toBe(400)
        expect(missing.json).toEqual({ error: INVALID_RULE_CONTENT_FIELD })
        expect(readFileSync(file).equals(before)).toBe(true)

        const locked = await put(
            port,
            { 'Content-Type': 'application/json' },
            JSON.stringify({ content: 'evil.com 1.2.3.4:1\n' }),
        )
        expect(locked.status).toBe(RULESET_READONLY_STATUS)
        expect(locked.json.code).toBe(RULESET_READONLY)
        expect(readFileSync(file).equals(before)).toBe(true)
    })
})

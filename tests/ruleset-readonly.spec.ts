import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/**
 * Issue #137: per-ruleset read-only lock. Runs the real proxy (index.js), the
 * real CLI (bin/index.js) and the real MCP server against a temp MEDDLE_HOME.
 * Every rejected write is checked by comparing the rule file's bytes.
 */

const repoRoot = join(__dirname, '..')
const READONLY_MESSAGE = '该规则集已设为只读，只能在 Meddle 界面中解锁'
const EXIT_RULESET_READONLY = 3

const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
}

afterAll(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

const LOCKED_CONTENT = '# locked\nlocked.example.com 127.0.0.1:3001\n'
const OPEN_CONTENT = 'open.example.com 127.0.0.1:3002\n'

/** A MEDDLE_HOME with two rulesets, both enabled; settings.json has no lock field (legacy). */
function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-137-'))
    homes.push(home)
    mkdirSync(join(home, 'route-rules'), { recursive: true })
    writeFileSync(join(home, 'route-rules', 'locked.txt'), LOCKED_CONTENT)
    writeFileSync(join(home, 'route-rules', 'open.txt'), OPEN_CONTENT)
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ activeRuleFiles: ['locked', 'open'], theme: 'light' }, null, 2))
    return home
}

interface Proxy { base: string; child: ChildProcessWithoutNullStreams; host: string }

async function startProxy(home: string): Promise<Proxy> {
    const port = await reservePort()
    const child = spawn(process.execPath, [join(repoRoot, 'index.js')], {
        cwd: repoRoot,
        env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1', PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    const output: string[] = []
    child.stdout.on('data', (c) => output.push(c.toString()))
    child.stderr.on('data', (c) => output.push(c.toString()))
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`proxy exited early: ${output.join('')}`)
        try {
            const res = await fetch(`${base}/api/rule-files`)
            if (res.ok && existsSync(join(home, 'mcp-proxy-url.json'))) return { base, child, host: `127.0.0.1:${port}` }
        } catch { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

const ruleBytes = (home: string, name: string) => readFileSync(join(home, 'route-rules', `${name}.txt`))
const readSettings = (home: string) => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))

async function call(base: string, method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* text body */ }
    return { status: res.status, json, text, headers: res.headers }
}

/** What the page gets: the token from index.html's meta tag. */
async function pageToken(base: string): Promise<string> {
    const html = await (await fetch(`${base}/`)).text()
    const match = html.match(/<meta name="meddle-ui-token" content="([0-9a-f]+)">/)
    if (!match) throw new Error('no ui token in page')
    return match[1]
}

function uiHeaders(p: Proxy, token: string): Record<string, string> {
    return { Origin: `http://${p.host}`, 'Sec-Fetch-Site': 'same-origin', 'X-Meddle-UI-Token': token }
}

async function setLock(p: Proxy, name: string, readonly: boolean) {
    const token = await pageToken(p.base)
    const res = await call(p.base, 'PUT', `/api/rule-files/${encodeURIComponent(name)}/readonly`, { readonly }, uiHeaders(p, token))
    expect(res.status, res.text).toBe(200)
    return res
}

async function list(base: string): Promise<Array<{ name: string; enabled: boolean; readonly: boolean }>> {
    return (await call(base, 'GET', '/api/rule-files')).json
}

function expectReadonlyRejection(res: { status: number; json: any }, ruleFile = 'locked') {
    expect(res.status).toBe(423)
    expect(res.json).toMatchObject({ code: 'RULESET_READONLY', error: READONLY_MESSAGE, ruleFile })
}

function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(repoRoot, 'bin', 'index.js'), ...args], {
            env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.on('error', reject)
        const guard = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('cli timed out')) }, 12_000)
        child.on('exit', (code) => { clearTimeout(guard); resolve({ code, stdout, stderr }) })
    })
}

describe('ruleset read-only lock — HTTP API (issue #137)', () => {
    let home: string
    let proxy: Proxy

    beforeAll(async () => {
        home = makeHome()
        proxy = await startProxy(home)
    })

    afterEach(async () => {
        // Each test starts from "locked is unlocked"; ignore 404 if a test renamed it away.
        const files = await list(proxy.base)
        for (const file of files.filter((f) => f.readonly)) await setLock(proxy, file.name, false)
    })

    it('legacy settings without the field: every ruleset is read-write and writable', async () => {
        expect(readSettings(home).readonlyRuleFiles).toBeUndefined()
        const files = await list(proxy.base)
        expect(files.map((f) => [f.name, f.readonly])).toEqual([['locked', false], ['open', false]])
        const res = await call(proxy.base, 'PUT', '/api/rule-files/open/content', { content: OPEN_CONTENT })
        expect(res.status).toBe(200)
        // Reading did not migrate anything.
        expect(readSettings(home).readonlyRuleFiles).toBeUndefined()
    })

    it('list, detail and content responses report readonly', async () => {
        await setLock(proxy, 'locked', true)
        expect(readSettings(home).readonlyRuleFiles).toEqual(['locked'])
        const files = await list(proxy.base)
        expect(files.find((f) => f.name === 'locked')?.readonly).toBe(true)
        expect(files.find((f) => f.name === 'open')?.readonly).toBe(false)

        const detail = await call(proxy.base, 'GET', '/api/rule-files/locked')
        expect(detail.json).toMatchObject({ name: 'locked', readonly: true, enabled: true, content: LOCKED_CONTENT })
        const openDetail = await call(proxy.base, 'GET', '/api/rule-files/open')
        expect(openDetail.json.readonly).toBe(false)

        const content = await call(proxy.base, 'GET', '/api/rule-files/locked/content')
        expect(content.status).toBe(200)
        expect(content.text).toBe(LOCKED_CONTENT)
        expect(content.headers.get('x-meddle-ruleset-readonly')).toBe('true')
    })

    it('rejects every write to a locked ruleset (CLI/MCP-style and web-UI-style requests); file bytes unchanged', async () => {
        await setLock(proxy, 'locked', true)
        const before = ruleBytes(home, 'locked')
        const settingsBefore = readSettings(home)
        // The web UI's own requests carry Origin, Sec-Fetch-Site and even a valid token: still rejected.
        const browser = uiHeaders(proxy, await pageToken(proxy.base))

        for (const headers of [{}, browser]) {
            expectReadonlyRejection(await call(proxy.base, 'PUT', '/api/rule-files/locked/content', { content: 'evil.com 1.2.3.4:1\n' }, headers))
            expectReadonlyRejection(await call(proxy.base, 'PUT', '/api/rule-files/locked', { enabled: false }, headers))
            expectReadonlyRejection(await call(proxy.base, 'PUT', '/api/rule-files/locked', { newName: 'renamed' }, headers))
            expectReadonlyRejection(await call(proxy.base, 'DELETE', '/api/rule-files/locked', undefined, headers))
            // Settings side doors: toggling via activeRuleFiles, or clearing the lock list.
            expectReadonlyRejection(await call(proxy.base, 'PATCH', '/api/settings', { activeRuleFiles: ['open'] }, headers))
            const clear = await call(proxy.base, 'PATCH', '/api/settings', { readonlyRuleFiles: [] }, headers)
            expect(clear.status).toBe(403)
            expect(clear.json.code).toBe('RULESET_LOCK_UI_ONLY')
        }

        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
        expect(existsSync(join(home, 'route-rules', 'renamed.txt'))).toBe(false)
        expect(readSettings(home).activeRuleFiles).toEqual(settingsBefore.activeRuleFiles)
        expect(readSettings(home).readonlyRuleFiles).toEqual(['locked'])

        // A whole-settings save that omits the field keeps the lock.
        const post = await call(proxy.base, 'POST', '/api/settings', { theme: 'dark', activeRuleFiles: ['locked', 'open'] })
        expect(post.status).toBe(200)
        expect(readSettings(home).readonlyRuleFiles).toEqual(['locked'])

        // The unlocked ruleset is untouched by the lock.
        expect((await call(proxy.base, 'PUT', '/api/rule-files/open/content', { content: OPEN_CONTENT })).status).toBe(200)
    })

    it('unlocking restores writes', async () => {
        await setLock(proxy, 'locked', true)
        expectReadonlyRejection(await call(proxy.base, 'PUT', '/api/rule-files/locked/content', { content: 'a.com 1.1.1.1:1\n' }))
        await setLock(proxy, 'locked', false)
        expect(readSettings(home).readonlyRuleFiles).toEqual([])
        const res = await call(proxy.base, 'PUT', '/api/rule-files/locked/content', { content: 'a.com 1.1.1.1:1\n' })
        expect(res.status).toBe(200)
        expect(ruleBytes(home, 'locked').toString()).toBe('a.com 1.1.1.1:1\n')
        expect((await call(proxy.base, 'PUT', '/api/rule-files/locked', { enabled: false })).status).toBe(200)
        expect((await call(proxy.base, 'PUT', '/api/rule-files/locked', { enabled: true })).status).toBe(200)
        writeFileSync(join(home, 'route-rules', 'locked.txt'), LOCKED_CONTENT)
    })

    it('lock endpoint: requires the page token and a same-origin request', async () => {
        const token = await pageToken(proxy.base)
        const lock = (headers: Record<string, string>) => call(proxy.base, 'PUT', '/api/rule-files/locked/readonly', { readonly: true }, headers)
        const origin = `http://${proxy.host}`

        // No token / wrong token.
        expect((await lock({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' })).json.code).toBe('UI_TOKEN_INVALID')
        expect((await lock({ Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Meddle-UI-Token': 'f'.repeat(64) })).status).toBe(403)
        // Right token, but not same-origin.
        expect((await lock({ 'X-Meddle-UI-Token': token })).json.code).toBe('UI_ORIGIN_REQUIRED')
        expect((await lock({ Origin: 'http://evil.example', 'X-Meddle-UI-Token': token })).status).toBe(403)
        expect((await lock({ Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'X-Meddle-UI-Token': token })).status).toBe(403)
        expect((await lock({ 'Sec-Fetch-Site': 'same-site', 'X-Meddle-UI-Token': token })).status).toBe(403)
        expect(readSettings(home).readonlyRuleFiles ?? []).toEqual([])

        // The same-origin bootstrap hands out the same token; cross-origin / header-less is refused.
        expect((await call(proxy.base, 'GET', '/api/ui-token')).status).toBe(403)
        expect((await call(proxy.base, 'GET', '/api/ui-token', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
        const boot = await call(proxy.base, 'GET', '/api/ui-token', undefined, { 'Sec-Fetch-Site': 'same-origin' })
        expect(boot.json.token).toBe(token)

        // Origin alone (older browsers without Sec-Fetch-*) is accepted when it matches Host.
        expect((await lock({ Origin: origin, 'X-Meddle-UI-Token': token })).status).toBe(200)
        expect((await list(proxy.base)).find((f) => f.name === 'locked')?.readonly).toBe(true)
    })

    it('rename of a locked ruleset is refused; after unlocking it renames and the new name is read-write', async () => {
        await setLock(proxy, 'locked', true)
        // A rename while locked is refused (the web UI also disables rename while locked, #143) …
        expectReadonlyRejection(await call(proxy.base, 'PUT', '/api/rule-files/locked', { newName: 'locked-2' }))
        expect((await list(proxy.base)).some((f) => f.name === 'locked-2')).toBe(false)
        // … so the user unlocks it first, then renames.
        await setLock(proxy, 'locked', false)
        const renamed = await call(proxy.base, 'PUT', '/api/rule-files/locked', { newName: 'locked-2' })
        expect(renamed.json).toMatchObject({ status: 'success', name: 'locked-2' })

        const files = await list(proxy.base)
        expect(files.find((f) => f.name === 'locked-2')).toMatchObject({ readonly: false, enabled: true })
        expect(files.some((f) => f.name === 'locked')).toBe(false)
        expect(readSettings(home).readonlyRuleFiles ?? []).toEqual([])

        // restore
        expect((await call(proxy.base, 'PUT', '/api/rule-files/locked-2', { newName: 'locked' })).status).toBe(200)
    })

    it('rename outside Meddle: new name is read-write, stale lock entry is dropped silently', async () => {
        await setLock(proxy, 'locked', true)
        const before = ruleBytes(home, 'locked')
        renameSync(join(home, 'route-rules', 'locked.txt'), join(home, 'route-rules', 'moved.txt'))

        const res = await call(proxy.base, 'GET', '/api/rule-files')
        expect(res.status).toBe(200)
        const files = res.json as Array<{ name: string; readonly: boolean }>
        expect(files.find((f) => f.name === 'moved')?.readonly).toBe(false)
        expect(files.some((f) => f.name === 'locked')).toBe(false)
        expect(readSettings(home).readonlyRuleFiles).toEqual([])

        // A file that later appears under the old name does not inherit the old lock.
        expect((await call(proxy.base, 'POST', '/api/rule-files', { name: 'locked', content: '' })).status).toBe(200)
        expect((await list(proxy.base)).find((f) => f.name === 'locked')?.readonly).toBe(false)

        // restore
        expect((await call(proxy.base, 'DELETE', '/api/rule-files/locked')).status).toBe(200)
        expect((await call(proxy.base, 'PUT', '/api/rule-files/moved', { newName: 'locked' })).status).toBe(200)
        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
    })
})

describe('ruleset read-only lock — restart (issue #137)', () => {
    it('the lock survives a restart; the old page token stops working', async () => {
        const home = makeHome()
        const first = await startProxy(home)
        await setLock(first, 'locked', true)
        const oldToken = await pageToken(first.base)
        await stopProcess(first.child)

        const second = await startProxy(home)
        const files = await list(second.base)
        expect(files.find((f) => f.name === 'locked')?.readonly).toBe(true)
        const before = ruleBytes(home, 'locked')
        expectReadonlyRejection(await call(second.base, 'PUT', '/api/rule-files/locked/content', { content: '' }))
        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)

        const stale = await call(second.base, 'PUT', '/api/rule-files/locked/readonly', { readonly: false }, uiHeaders(second, oldToken))
        expect(stale.status).toBe(403)
        expect(stale.json.code).toBe('UI_TOKEN_INVALID')
        await stopProcess(second.child)
    }, 40_000)
})

describe('ruleset read-only lock — CLI (issue #137)', () => {
    let home: string
    let proxy: Proxy

    beforeAll(async () => {
        home = makeHome()
        proxy = await startProxy(home)
        await setLock(proxy, 'locked', true)
    })

    it('route add / update / delete / active set exit with the dedicated code; files unchanged', async () => {
        const before = ruleBytes(home, 'locked')
        const openBefore = ruleBytes(home, 'open')
        const cases: string[][] = [
            ['route', 'add', 'locked', 'new.example.com', '127.0.0.1:9'],
            ['route', 'update', 'locked', 'locked.example.com', '127.0.0.1:9'],
            ['route', 'delete', 'locked', 'locked.example.com'],
            ['route', 'active', 'set', 'open'],
        ]
        for (const args of cases) {
            const { code, stdout, stderr } = await runCli(args, home)
            expect(code, `${args.join(' ')}\n${stdout}${stderr}`).toBe(EXIT_RULESET_READONLY)
            expect(stderr).toContain(READONLY_MESSAGE)
            expect(stderr).toContain('RULESET_READONLY')
            // Never silently falls back to writing the file.
            expect(stderr + stdout).not.toContain('could not connect to a running proxy')
        }
        const json = await runCli(['route', 'add', 'locked', 'x.example.com', '127.0.0.1:9', '--json'], home)
        expect(json.code).toBe(EXIT_RULESET_READONLY)
        expect(JSON.parse(json.stdout.trim())).toEqual({
            success: false,
            error: { code: 'RULESET_READONLY', message: READONLY_MESSAGE, ruleFile: 'locked' },
        })

        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
        expect(ruleBytes(home, 'open').equals(openBefore)).toBe(true)
        // active set did not half-apply: both stay enabled.
        expect((await list(proxy.base)).map((f) => [f.name, f.enabled])).toEqual([['locked', true], ['open', true]])
    }, 60_000)

    it('writes to an unlocked ruleset still work', async () => {
        const { code } = await runCli(['route', 'add', 'open', 'more.example.com', '127.0.0.1:7'], home)
        expect(code).toBe(0)
        expect(ruleBytes(home, 'open').toString()).toContain('more.example.com')
    }, 15_000)

    it('route list / show --json include readonly', async () => {
        const listed = await runCli(['route', 'list', '--json'], home)
        expect(listed.code).toBe(0)
        const files = JSON.parse(listed.stdout)
        expect(files.map((f: any) => [f.name, f.readonly])).toEqual([['locked', true], ['open', false]])
        const shown = await runCli(['route', 'show', 'locked', '--json'], home)
        expect(JSON.parse(shown.stdout)).toMatchObject({ file: 'locked', readonly: true })
        const shownOpen = await runCli(['route', 'show', 'open', '--json'], home)
        expect(JSON.parse(shownOpen.stdout).readonly).toBe(false)
    }, 30_000)

    it('file mode (no proxy) honours the lock too', async () => {
        const offline = makeHome()
        const settings = readSettings(offline)
        writeFileSync(join(offline, 'settings.json'), JSON.stringify({ ...settings, readonlyRuleFiles: ['locked'] }))
        writeFileSync(join(offline, 'mcp-proxy-url.json'), JSON.stringify({ proxyUrl: 'http://127.0.0.1:1' }))
        const before = ruleBytes(offline, 'locked')
        const { code, stderr } = await runCli(['route', 'add', 'locked', 'x.example.com', '127.0.0.1:9'], offline)
        expect(code).toBe(EXIT_RULESET_READONLY)
        expect(stderr).toContain(READONLY_MESSAGE)
        expect(ruleBytes(offline, 'locked').equals(before)).toBe(true)
        const listed = JSON.parse((await runCli(['route', 'list', '--json'], offline)).stdout)
        expect(listed.find((f: any) => f.name === 'locked').readonly).toBe(true)
    }, 30_000)
})

describe('ruleset read-only lock — MCP (issue #137)', () => {
    let home: string
    let client: Client

    beforeAll(async () => {
        home = makeHome()
        const proxy = await startProxy(home)
        await setLock(proxy, 'locked', true)
        client = new Client({ name: 'meddle-137-test', version: '0.0.0' })
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [join(repoRoot, 'mcp-server.js')],
            env: { ...process.env, MEDDLE_HOME: home } as Record<string, string>,
            stderr: 'ignore',
        }))
    }, 30_000)

    afterAll(async () => { await client?.close() })

    const text = (result: any) => result.content.map((c: any) => c.text).join('\n')

    it('route write tools say read-only rulesets are rejected; no lock/unlock tool exists', async () => {
        const { tools } = await client.listTools()
        for (const name of ['route_rule_add', 'route_rule_update', 'route_rule_delete', 'route_rule_active_set', 'route_rule_create_file']) {
            expect(tools.find((t) => t.name === name)?.description).toContain('只读规则集会被拒绝')
        }
        expect(tools.some((t) => /lock|readonly/i.test(t.name))).toBe(false)
    })

    it('write tools return RULESET_READONLY and leave the file unchanged', async () => {
        const before = ruleBytes(home, 'locked')
        const calls = [
            { name: 'route_rule_add', arguments: { ruleFile: 'locked', pattern: 'x.example.com', target: '127.0.0.1:9' } },
            { name: 'route_rule_update', arguments: { ruleFile: 'locked', pattern: 'locked.example.com', newTarget: '127.0.0.1:9' } },
            { name: 'route_rule_delete', arguments: { ruleFile: 'locked', pattern: 'locked.example.com' } },
            { name: 'route_rule_active_set', arguments: { ruleFile: 'open' } },
        ]
        for (const c of calls) {
            const result: any = await client.callTool(c)
            expect(result.isError, c.name).toBe(true)
            expect(JSON.parse(text(result))).toEqual({ error: { code: 'RULESET_READONLY', message: READONLY_MESSAGE, ruleFile: 'locked' } })
        }
        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
        expect(readSettings(home).activeRuleFiles).toEqual(['locked', 'open'])
    })

    it('route_rule_list reports readonly for the list and for one file', async () => {
        const all = JSON.parse(text(await client.callTool({ name: 'route_rule_list', arguments: {} })))
        expect(all.map((f: any) => [f.name, f.readonly])).toEqual([['locked', true], ['open', false]])
        const one = JSON.parse(text(await client.callTool({ name: 'route_rule_list', arguments: { ruleFile: 'locked' } })))
        expect(one).toMatchObject({ ruleFile: 'locked', readonly: true, ruleCount: 1 })
    })
})

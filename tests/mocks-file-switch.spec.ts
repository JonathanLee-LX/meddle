import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Issue #118: after changing `mocksFilePath` in settings, refresh-config (and
 * saving the setting) must switch reads, writes, the id counter and the file
 * watcher to the new file, leaving the old file untouched.
 * Uses a real index.js with a temp MEDDLE_HOME (same harness as #115).
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []

afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-118-'))
    homes.push(home)
    return home
}

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
}

async function startProxy(home: string): Promise<{ base: string; output: string[] }> {
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
            const res = await fetch(`${base}/api/mocks`)
            if (res.ok) return { base, output }
        } catch (_) { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

type Rule = { id: number; name: string }

function rule(id: number, name: string) {
    return {
        id, name, urlPattern: `/${name}`, query: '', method: '*', statusCode: 200, delay: 0,
        bodyType: 'inline', headers: {}, body: '', enabled: true,
    }
}

function writeMocks(file: string, nextId: number, rules: ReturnType<typeof rule>[]): void {
    writeFileSync(file, JSON.stringify({ nextId, rules }, null, 2), 'utf8')
}

async function api<T = any>(base: string, method: string, pathname: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    expect(res.ok, `${method} ${pathname} -> ${res.status}`).toBe(true)
    return await res.json() as T
}

const list = (base: string) => api<Rule[]>(base, 'GET', '/api/mocks')
const names = (rules: Array<{ name: string }>) => rules.map((r) => r.name).sort()
const readRules = (file: string): Rule[] => JSON.parse(readFileSync(file, 'utf8')).rules

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await predicate()) return
        await delay(50)
    }
    throw new Error('waitFor timed out')
}

/** Write settings.json directly (what a hand edit / another client would do). */
function setMocksPathOnDisk(home: string, mocksFilePath: string | undefined): void {
    const settingsPath = join(home, 'settings.json')
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
    if (mocksFilePath) settings.mocksFilePath = mocksFilePath
    else delete settings.mocksFilePath
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

describe('switching mocksFilePath at runtime (issue #118)', () => {
    it('refresh-config switches list, create/update/delete, id counter and watcher to the new file', async () => {
        const home = makeHome()
        const oldFile = join(home, 'mocks.json')
        const newFile = join(home, 'alt-mocks.json')
        writeMocks(oldFile, 3, [rule(1, 'old-a'), rule(2, 'old-b')])
        writeMocks(newFile, 10, [rule(4, 'new-x'), rule(9, 'new-y')])
        const { base } = await startProxy(home)
        expect(names(await list(base))).toEqual(['old-a', 'old-b'])
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: oldFile, exists: true, custom: false })
        const oldBytes = readFileSync(oldFile, 'utf8')

        setMocksPathOnDisk(home, newFile)
        const refreshed = await api<{ status: string; mocksPath: string }>(base, 'POST', '/api/refresh-config')
        expect(refreshed).toMatchObject({ status: 'success', mocksPath: newFile })
        expect(names(await list(base))).toEqual(['new-x', 'new-y'])
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: newFile, exists: true, custom: true })

        // create -> new file, id from the new file's counter
        const created = await api<{ rule: Rule }>(base, 'POST', '/api/mocks', { name: 'new-z', urlPattern: '/z' })
        expect(created.rule.id).toBe(10)
        expect(names(readRules(newFile))).toEqual(['new-x', 'new-y', 'new-z'])
        // update + delete -> new file
        await api(base, 'PUT', '/api/mocks/4', { name: 'new-x2' })
        await api(base, 'DELETE', '/api/mocks/9')
        expect(names(readRules(newFile))).toEqual(['new-x2', 'new-z'])
        expect(JSON.parse(readFileSync(newFile, 'utf8')).nextId).toBe(11)
        // old file untouched throughout
        expect(readFileSync(oldFile, 'utf8')).toBe(oldBytes)

        // watcher follows the new file …
        writeMocks(newFile, 20, [...JSON.parse(readFileSync(newFile, 'utf8')).rules, rule(15, 'hand-edit')])
        await waitFor(async () => names(await list(base)).includes('hand-edit'))
        // … and no longer reacts to the old one
        writeMocks(oldFile, 5, [rule(1, 'old-a'), rule(2, 'old-b'), rule(3, 'old-hand-edit')])
        await delay(600)
        expect(names(await list(base))).toEqual(['hand-edit', 'new-x2', 'new-z'])
    }, 30_000)

    it('a configured file that does not exist yet starts empty and is created on first save; old file kept', async () => {
        const home = makeHome()
        const oldFile = join(home, 'mocks.json')
        const newFile = join(home, 'nested', 'dir', 'fresh-mocks.json')
        writeMocks(oldFile, 3, [rule(1, 'old-a'), rule(2, 'old-b')])
        const { base } = await startProxy(home)
        const oldBytes = readFileSync(oldFile, 'utf8')

        setMocksPathOnDisk(home, newFile)
        const refreshed = await api<{ mocksPath: string }>(base, 'POST', '/api/refresh-config')
        expect(refreshed.mocksPath).toBe(newFile)
        expect(await list(base)).toEqual([])
        expect(existsSync(newFile)).toBe(false)
        // UI status: the missing file is reported with its absolute path
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: newFile, exists: false, custom: true })

        const created = await api<{ rule: Rule }>(base, 'POST', '/api/mocks', { name: 'first', urlPattern: '/f' })
        expect(created.rule.id).toBe(1)
        expect(names(readRules(newFile))).toEqual(['first'])
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: newFile, exists: true, custom: true })
        expect(readFileSync(oldFile, 'utf8')).toBe(oldBytes)

        // the watcher was moved to the new (just created) file
        writeMocks(newFile, 5, [rule(1, 'first'), rule(4, 'hand-edit')])
        await waitFor(async () => names(await list(base)).includes('hand-edit'))
    }, 30_000)

    it('saving mocksFilePath via POST /api/settings switches immediately; switching back resumes the old file', async () => {
        const home = makeHome()
        const oldFile = join(home, 'mocks.json')
        const newFile = join(home, 'alt-mocks.json')
        writeMocks(oldFile, 7, [rule(1, 'old-a'), rule(6, 'old-b')])
        writeMocks(newFile, 3, [rule(2, 'new-x')])
        const { base } = await startProxy(home)

        const settings = await api<Record<string, unknown>>(base, 'GET', '/api/settings')
        await api(base, 'POST', '/api/settings', { ...settings, mocksFilePath: newFile })
        expect(names(await list(base))).toEqual(['new-x'])
        const created = await api<{ rule: Rule }>(base, 'POST', '/api/mocks', { name: 'new-y', urlPattern: '/y' })
        expect(created.rule.id).toBe(3)
        expect(names(readRules(newFile))).toEqual(['new-x', 'new-y'])

        // an unrelated settings save does not reload / switch
        await api(base, 'POST', '/api/settings', { ...settings, mocksFilePath: newFile, theme: 'dark' })
        expect(names(await list(base))).toEqual(['new-x', 'new-y'])

        // clearing the setting goes back to the default file and its counter
        await api(base, 'POST', '/api/settings', { ...settings, theme: 'dark' })
        expect(names(await list(base))).toEqual(['old-a', 'old-b'])
        const back = await api<{ rule: Rule }>(base, 'POST', '/api/mocks', { name: 'old-c', urlPattern: '/c' })
        expect(back.rule.id).toBe(7)
        expect(names(readRules(oldFile))).toEqual(['old-a', 'old-b', 'old-c'])
        expect(names(readRules(newFile))).toEqual(['new-x', 'new-y'])
    }, 30_000)

    it('GET /api/mocks keeps its bare-array shape; /api/mocks-file reports default vs custom and absolute paths', async () => {
        const home = makeHome()
        const { base } = await startProxy(home)
        expect(Array.isArray(await list(base))).toBe(true)
        // default path not created yet: reported as default (UI stays silent)
        expect(existsSync(join(home, 'mocks.json'))).toBe(false)
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: join(home, 'mocks.json'), exists: false, custom: false })
        // relative paths resolve against the proxy cwd (repo root in this
        // harness); point it back into the temp home so nothing lands in the repo
        const absolute = join(home, 'rel', 'mocks.json')
        setMocksPathOnDisk(home, relative(repoRoot, absolute))
        await api(base, 'POST', '/api/refresh-config')
        expect(Array.isArray(await list(base))).toBe(true)
        expect(await api(base, 'GET', '/api/mocks-file')).toEqual({ path: absolute, exists: false, custom: true })
    }, 30_000)
})

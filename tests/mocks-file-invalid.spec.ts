import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, unlinkSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Issue #120: an unparseable mocks file must never be overwritten.
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
    const home = mkdtempSync(join(tmpdir(), 'meddle-120-'))
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

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

// Line 4 col 5: the trailing `}` after a missing value.
const BROKEN = '{\n  "nextId": 3,\n  "rules": [\n    {"id": 1, "name": "keep-me", "urlPattern": "/k"},\n  ]\n}\n'

async function raw(base: string, method: string, pathname: string, body?: unknown) {
    const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() as any }
}

async function expectAllWritesRefused(base: string, file: string): Promise<void> {
    const before = sha(file)
    const ops: Array<[string, string, unknown?]> = [
        ['POST', '/api/mocks', { name: 'new', urlPattern: '/n' }],
        ['PUT', '/api/mocks/1', { name: 'edited' }],
        ['PUT', '/api/mocks/1', { enabled: false }], // toggle
        ['PUT', '/api/mocks/999', { name: 'stale-tab' }], // id only a stale tab knows
        ['DELETE', '/api/mocks/1'],
    ]
    for (const [method, p, body] of ops) {
        const r = await raw(base, method, p, body)
        expect(r.status, `${method} ${p}`).toBe(409)
        expect(r.body.code).toBe('MOCKS_FILE_INVALID')
        expect(r.body.error).toContain(file)
        expect(r.body.error).toMatch(/第 \d+ 行第 \d+ 列/)
        expect(sha(file), `${method} ${p} must leave the file byte-identical`).toBe(before)
    }
    // no stray temp files left behind
    const dir = join(file, '..')
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
}

describe('invalid mocks JSON (issue #120)', () => {
    it('starting with a broken file: reports the error, refuses every write, file byte-identical', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeFileSync(file, BROKEN, 'utf8')
        const hash = sha(file)
        const { base, output } = await startProxy(home)

        expect(await list(base)).toEqual([])
        const status = await api(base, 'GET', '/api/mocks-file')
        expect(status).toMatchObject({ path: file, exists: true, valid: false, parseError: { line: 5, column: 3 } })
        expect(status.parseError.message).toBeTruthy()
        expect(status.error).toContain(file)
        expect(output.join('')).toContain(file) // terminal shows the same error

        await expectAllWritesRefused(base, file)
        // refresh-config re-reads and still refuses
        const refreshed = await api(base, 'POST', '/api/refresh-config')
        expect(refreshed.mocksParseError).toMatchObject({ line: 5, column: 3 })
        await expectAllWritesRefused(base, file)
        expect(sha(file)).toBe(hash)
    }, 30_000)

    it('switching to a broken file via settings refuses writes; old file untouched', async () => {
        const home = makeHome()
        const good = join(home, 'mocks.json')
        const broken = join(home, 'broken.json')
        writeMocks(good, 2, [rule(1, 'good')])
        writeFileSync(broken, '{"rules": [', 'utf8')
        const goodHash = sha(good)
        const { base } = await startProxy(home)
        setMocksPathOnDisk(home, broken)
        await api(base, 'POST', '/api/refresh-config')
        const status = await api(base, 'GET', '/api/mocks-file')
        expect(status).toMatchObject({ path: broken, valid: false, parseError: { line: 1, column: 12 } })
        await expectAllWritesRefused(base, broken)
        expect(sha(good)).toBe(goodHash)
    }, 30_000)

    it('file broken externally before the watcher fires: write re-validates on disk and is refused', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeMocks(file, 2, [rule(1, 'a')])
        const { base } = await startProxy(home)
        expect(names(await list(base))).toEqual(['a'])
        writeFileSync(file, BROKEN, 'utf8') // and immediately write, racing the watcher
        const hash = sha(file)
        const r = await raw(base, 'POST', '/api/mocks', { name: 'stale', urlPattern: '/s' })
        expect(r.status).toBe(409)
        expect(sha(file)).toBe(hash)
    }, 30_000)

    it('fixing the file auto-recovers via the watcher (no restart / refresh)', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeFileSync(file, BROKEN, 'utf8')
        const { base } = await startProxy(home)
        expect((await api(base, 'GET', '/api/mocks-file')).valid).toBe(false)

        writeMocks(file, 3, [rule(1, 'keep-me')])
        await waitFor(async () => (await api(base, 'GET', '/api/mocks-file')).valid === true)
        expect(names(await list(base))).toEqual(['keep-me'])
        const created = await api(base, 'POST', '/api/mocks', { name: 'after-fix', urlPattern: '/f' })
        expect(created.rule.id).toBe(3)
        expect(names(readRules(file))).toEqual(['after-fix', 'keep-me'])

        // breaking it again flips back to the error state via the watcher
        writeFileSync(file, BROKEN, 'utf8')
        await waitFor(async () => (await api(base, 'GET', '/api/mocks-file')).valid === false)
        await expectAllWritesRefused(base, file)
    }, 30_000)

    it.each([['empty', ''], ['whitespace-only', '  \n\t\n']])('%s file is an empty list, not an error', async (_n, text) => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeFileSync(file, text, 'utf8')
        const { base } = await startProxy(home)
        expect(await api(base, 'GET', '/api/mocks-file')).toMatchObject({ valid: true, parseError: null })
        const created = await api(base, 'POST', '/api/mocks', { name: 'first', urlPattern: '/f' })
        expect(created.rule.id).toBe(1)
        expect(names(readRules(file))).toEqual(['first'])
    }, 30_000)
})

describe('mocks write through a symlink (issue #123)', () => {
    it('keeps the symlink, updates the real target and preserves its mode', async () => {
        const home = makeHome()
        const realDir = join(home, 'dotfiles')
        mkdirSync(realDir)
        const target = join(realDir, 'mocks.json')
        writeMocks(target, 2, [rule(1, 'a')])
        chmodSync(target, 0o640)
        const link = join(home, 'mocks.json')
        symlinkSync(target, link)
        const { base } = await startProxy(home)

        await api(base, 'POST', '/api/mocks', { name: 'b', urlPattern: '/b' })
        await api(base, 'PUT', '/api/mocks/1', { name: 'a2' })

        expect(lstatSync(link).isSymbolicLink()).toBe(true)
        expect(readlinkSync(link)).toBe(target)
        expect(names(readRules(target))).toEqual(['a2', 'b'])
        expect(statSync(target).mode & 0o777).toBe(0o640)
        expect(readdirSync(realDir).filter((f) => f.endsWith('.tmp'))).toEqual([])
        expect(readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([])
    }, 30_000)

    it('relative symlink: target resolved against the link directory', async () => {
        const home = makeHome()
        mkdirSync(join(home, 'real'))
        const target = join(home, 'real', 'm.json')
        writeMocks(target, 1, [])
        symlinkSync('real/m.json', join(home, 'mocks.json'))
        const { base } = await startProxy(home)
        await api(base, 'POST', '/api/mocks', { name: 'r', urlPattern: '/r' })
        expect(lstatSync(join(home, 'mocks.json')).isSymbolicLink()).toBe(true)
        expect(names(readRules(target))).toEqual(['r'])
    }, 30_000)

    it('dangling symlink whose directory exists: creates the target, link kept', async () => {
        const home = makeHome()
        mkdirSync(join(home, 'dotfiles'))
        const target = join(home, 'dotfiles', 'mocks.json')
        const link = join(home, 'mocks.json')
        symlinkSync(target, link)
        const { base } = await startProxy(home)
        await api(base, 'POST', '/api/mocks', { name: 'first', urlPattern: '/f' })
        expect(lstatSync(link).isSymbolicLink()).toBe(true)
        expect(names(readRules(target))).toEqual(['first'])
    }, 30_000)

    it('dangling symlink whose directory is missing: clear error, link untouched', async () => {
        const home = makeHome()
        const target = join(home, 'missing-dir', 'mocks.json')
        const link = join(home, 'mocks.json')
        symlinkSync(target, link)
        const { base } = await startProxy(home)
        const r = await raw(base, 'POST', '/api/mocks', { name: 'x', urlPattern: '/x' })
        expect(r.status).toBe(400)
        expect(r.body.error).toContain('符号链接')
        expect(r.body.error).toContain(target)
        expect(lstatSync(link).isSymbolicLink()).toBe(true)
        expect(existsSync(join(home, 'missing-dir'))).toBe(false)
        expect(await list(base)).toEqual([]) // memory rolled back
    }, 30_000)

    it('watcher follows the symlink target: direct edits refresh the list, broken -> fixed recovers, retarget followed', async () => {
        const home = makeHome()
        const realDir = join(home, 'dotfiles')
        mkdirSync(realDir)
        const target = join(realDir, 'mocks.json')
        writeMocks(target, 2, [rule(1, 'a')])
        const link = join(home, 'mocks.json')
        symlinkSync(target, link)
        const { base } = await startProxy(home)
        expect(names(await list(base))).toEqual(['a'])

        // e.g. git pull in the dotfiles repo
        writeMocks(target, 3, [rule(1, 'a'), rule(2, 'pulled')])
        await waitFor(async () => names(await list(base)).includes('pulled'))

        writeFileSync(target, BROKEN, 'utf8')
        await waitFor(async () => (await api(base, 'GET', '/api/mocks-file')).valid === false)
        writeMocks(target, 3, [rule(1, 'fixed')])
        await waitFor(async () => (await api(base, 'GET', '/api/mocks-file')).valid === true)
        expect(names(await list(base))).toEqual(['fixed'])

        // the link itself is retargeted to a file in another directory
        const otherDir = join(home, 'other')
        mkdirSync(otherDir)
        const other = join(otherDir, 'mocks.json')
        writeMocks(other, 2, [rule(1, 'other')])
        unlinkSync(link)
        symlinkSync(other, link)
        await waitFor(async () => names(await list(base)).includes('other'))
        writeMocks(other, 3, [rule(1, 'other'), rule(2, 'other-edit')])
        await waitFor(async () => names(await list(base)).includes('other-edit'))
        expect(lstatSync(link).isSymbolicLink()).toBe(true)
    }, 60_000)

    it('last write of a rapid burst is not lost (issue #128: chokidar drops events inside its 5ms throttle)', async () => {
        // A burst right after start-up is where the dropped trailing event
        // showed up in CI; repeat it across fresh proxies to make it likely.
        const spin = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { /* stay inside chokidar's throttle window */ } }
        for (let round = 1; round <= 6; round++) {
            const home = makeHome()
            const dir = join(home, 'dotfiles')
            mkdirSync(dir)
            const target = join(dir, 'mocks.json')
            writeMocks(target, 2, [rule(1, 'start')])
            symlinkSync(target, join(home, 'mocks.json'))
            const { base } = await startProxy(home)
            for (let burst = 0; burst < 5; burst++) {
                writeMocks(target, 3, [rule(1, `pulled${burst}`)])
                spin(1)
                writeFileSync(target, BROKEN, 'utf8')
                spin(2)
                writeMocks(target, 3, [rule(1, `fixed${round}-${burst}`)])
                await waitFor(async () => {
                    const f = await api(base, 'GET', '/api/mocks-file')
                    return f.valid === true && names(await list(base)).includes(`fixed${round}-${burst}`)
                }, 3_000)
                await delay(20 * burst)
            }
        }
    }, 120_000)

    it('symlink whose target directory is created after startup gets watched (issue #125)', async () => {
        const home = makeHome()
        const realDir = join(home, 'later', 'dotfiles')
        const target = join(realDir, 'mocks.json')
        mkdirSync(join(home, 'links'))
        const link = join(home, 'links', 'mocks.json')
        symlinkSync(target, link) // dangling: neither 'later' nor 'dotfiles' exists yet
        setMocksPathOnDisk(home, link)
        const { base } = await startProxy(home)
        expect(names(await list(base))).toEqual([])
        await delay(300) // let the initial watch settle
        mkdirSync(realDir, { recursive: true })
        await delay(300)
        writeMocks(target, 2, [rule(1, 'created-later')])
        await waitFor(async () => names(await list(base)).includes('created-later'))
        writeMocks(target, 3, [rule(1, 'created-later'), rule(2, 'edited')])
        await waitFor(async () => names(await list(base)).includes('edited'))
    }, 60_000)

    it('symlink retargeted to a new directory: an edit right after the switch is not lost', async () => {
        const home = makeHome()
        mkdirSync(join(home, 'd0'))
        writeMocks(join(home, 'd0', 'mocks.json'), 2, [rule(1, 'r0')])
        const link = join(home, 'mocks.json')
        symlinkSync(join(home, 'd0', 'mocks.json'), link)
        const { base } = await startProxy(home)
        for (let round = 1; round <= 5; round++) {
            const dir = join(home, `d${round}`)
            mkdirSync(dir)
            const file = join(dir, 'mocks.json')
            writeMocks(file, 2, [rule(1, `r${round}`)])
            unlinkSync(link)
            symlinkSync(file, link)
            await waitFor(async () => names(await list(base)).includes(`r${round}`), 3_000)
            writeMocks(file, 3, [rule(1, `r${round}`), rule(2, `edit${round}`)]) // immediately
            await waitFor(async () => names(await list(base)).includes(`edit${round}`), 3_000)
        }
    }, 60_000)

    it('write that lands while the watcher is still starting is not lost (CI flake root cause)', async () => {
        const home = makeHome()
        const { base } = await startProxy(home)
        for (let round = 0; round < 5; round++) {
            const file = join(home, `switch-${round}.json`)
            writeMocks(file, 2, [rule(1, `before-${round}`)])
            setMocksPathOnDisk(home, file)
            await api(base, 'POST', '/api/refresh-config') // watcher restarts here
            writeMocks(file, 3, [rule(1, `before-${round}`), rule(2, `racing-${round}`)]) // immediately
            await waitFor(async () => names(await list(base)).includes(`racing-${round}`), 3_000)
        }
    }, 60_000)
})

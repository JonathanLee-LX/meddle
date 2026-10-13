import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveConfiguredMocksPath } from '../core/mock-handler'

/**
 * Issue #121: a stale tab saving one setting must not revert fields another
 * tab changed (partial PATCH), and `~` in mocksFilePath expands to the home
 * directory. Real index.js with a temp MEDDLE_HOME (same harness as #118).
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const dirs: string[] = []

afterEach(async () => {
    for (const child of children.splice(0)) {
        if (child.exitCode === null) {
            child.kill('SIGTERM')
            await Promise.race([once(child, 'exit'), delay(2_000)])
            if (child.exitCode === null) child.kill('SIGKILL')
        }
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(d)
    return d
}

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function startProxy(home: string, env: Record<string, string> = {}): Promise<string> {
    const port = await reservePort()
    const child = spawn(process.execPath, [join(repoRoot, 'index.js')], {
        cwd: repoRoot,
        env: { ...process.env, ...env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1', PORT: String(port) },
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
            if ((await fetch(`${base}/api/mocks`)).ok) return base
        } catch (_) { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

async function call(base: string, method: string, pathname: string, body?: unknown): Promise<any> {
    const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    expect(res.ok, `${method} ${pathname} -> ${res.status}`).toBe(true)
    return res.json()
}

const readSettings = (home: string) => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))

describe('settings partial save (issue #121)', () => {
    it('stale tab saving another setting keeps the path set by a newer tab', async () => {
        const home = tmp('meddle-121-')
        writeFileSync(join(home, 'settings.json'), JSON.stringify({ theme: 'light', fontSize: 'medium' }), 'utf8')
        const base = await startProxy(home)

        // Tab B loads settings and keeps them around (stale).
        const staleB = await call(base, 'GET', '/api/settings')
        expect(staleB.mocksFilePath ?? '').toBe('')

        // Tab A switches the mocks file.
        const newFile = join(home, 'team-mocks.json')
        await call(base, 'PATCH', '/api/settings', { mocksFilePath: newFile })
        expect((await call(base, 'GET', '/api/mocks-file')).path).toBe(newFile)

        // Tab B (old) changes only the theme.
        await call(base, 'PATCH', '/api/settings', { theme: 'dark' })

        const onDisk = readSettings(home)
        expect(onDisk).toMatchObject({ theme: 'dark', fontSize: 'medium', mocksFilePath: newFile })
        expect((await call(base, 'GET', '/api/mocks-file')).path).toBe(newFile)
    }, 30_000)

    it('PATCH rejects non-object bodies and leaves settings untouched', async () => {
        const home = tmp('meddle-121-')
        writeFileSync(join(home, 'settings.json'), JSON.stringify({ theme: 'light' }), 'utf8')
        const base = await startProxy(home)
        const before = readFileSync(join(home, 'settings.json'), 'utf8')
        const res = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '[1]' })
        expect(res.status).toBe(400)
        expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe(before)
    }, 30_000)

    it('~/x/mocks.json expands to the home directory for reads and writes', async () => {
        const home = tmp('meddle-121-')
        const fakeUserHome = tmp('meddle-121-user-')
        mkdirSync(join(fakeUserHome, 'x'))
        writeFileSync(join(fakeUserHome, 'x', 'mocks.json'), JSON.stringify({ nextId: 2, rules: [{ id: 1, name: 'from-home', urlPattern: '/h' }] }), 'utf8')
        const base = await startProxy(home, { HOME: fakeUserHome, USERPROFILE: fakeUserHome })

        await call(base, 'PATCH', '/api/settings', { mocksFilePath: '~/x/mocks.json' })
        const status = await call(base, 'GET', '/api/mocks-file')
        const expected = join(fakeUserHome, 'x', 'mocks.json')
        expect(status).toMatchObject({ path: expected, exists: true, custom: true })
        expect((await call(base, 'GET', '/api/mocks')).map((r: any) => r.name)).toEqual(['from-home'])

        await call(base, 'POST', '/api/mocks', { name: 'written', urlPattern: '/w' })
        const rules = JSON.parse(readFileSync(expected, 'utf8')).rules.map((r: any) => r.name).sort()
        expect(rules).toEqual(['from-home', 'written'])
        // nothing created under a literal "~" directory
        expect(existsSync(join(repoRoot, '~'))).toBe(false)
        expect(existsSync(join(home, '~'))).toBe(false)
        // settings keep what the user typed
        expect(readSettings(home).mocksFilePath).toBe('~/x/mocks.json')
    }, 30_000)
})

describe('resolveConfiguredMocksPath (issue #121)', () => {
    const meddle = '/srv/meddle-home'
    const user = '/home/alice'
    it.each([
        ['', null],
        ['   ', null],
        ['~', user],
        ['~/x/mocks.json', '/home/alice/x/mocks.json'],
        ['/abs/m.json', '/abs/m.json'],
        ['rel/m.json', '/srv/meddle-home/rel/m.json'],
        ['~bob/m.json', '/srv/meddle-home/~bob/m.json'],
    ])('%j -> %j', (raw, expected) => {
        expect(resolveConfiguredMocksPath(raw, meddle, user)).toBe(expected)
    })
})

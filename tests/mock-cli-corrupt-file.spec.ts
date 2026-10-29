import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { formatMocksParseError, parseMocksFileText } from '../core/mock-handler'
import { isApiHttpError, isProxyUnreachableError } from '../bin/lib/proxy-or-file'

/**
 * A corrupt mocks.json must never be rewritten by `meddle mock`.
 * HTTP 4xx/5xx is the proxy's answer (print the body, exit 1, leave the file).
 * Direct file writes run only when the proxy is unreachable, and they refuse
 * to parse a broken file instead of treating it as [].
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []

afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-mock-corrupt-'))
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

async function startProxy(home: string): Promise<{ base: string; port: number }> {
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
            if (res.ok) return { base, port }
        } catch { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

function runCli(args: string[], home: string, port: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(repoRoot, 'bin', 'index.js'), ...args], {
            env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1', MEDDLE_SESSION_PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.on('error', reject)
        const guard = setTimeout(() => {
            try { child.kill('SIGTERM') } catch { /* already gone */ }
            reject(new Error(`cli timed out: ${args.join(' ')}`))
        }, 12_000)
        child.on('exit', (code) => {
            clearTimeout(guard)
            resolve({ code, stdout, stderr })
        })
    })
}

function rule(id: number, name: string) {
    return {
        id, name, urlPattern: `/${name}`, query: '', method: '*', statusCode: 200, delay: 0,
        bodyType: 'inline', headers: {}, body: name, enabled: true,
    }
}

/** Pretty JSON with one comma removed — the QA repro. */
function corruptMocks(rules = [rule(1, 'keep'), rule(2, 'also')]): string {
    return JSON.stringify({ nextId: 3, rules }, null, 2).replace(',', '')
}

function writeRefusal(file: string, text: string): string {
    const parsed = parseMocksFileText(text)
    expect(parsed.error).toBeTruthy()
    return formatMocksParseError(file, parsed.error!)
}

function listRefusal(file: string, text: string): string {
    return writeRefusal(file, text).replace(
        'Mock 文件格式错误，已禁止写入以免覆盖:',
        'Mock 文件格式错误:',
    )
}

const MUTATIONS: string[][] = [
    ['mock', 'add', '--name', 'A', '--pattern', 'a.test', '--body', 'a'],
    ['mock', 'update', '1', '--body', 'changed'],
    ['mock', 'enable', '1'],
    ['mock', 'disable', '1'],
    ['mock', 'delete', '1'],
]

describe('API error vs unreachable', () => {
    it('does not treat an HTTP status as a dead proxy', () => {
        const err = Object.assign(new Error('{"error":"no"}'), { status: 409 })
        expect(isApiHttpError(err)).toBe(true)
        expect(isProxyUnreachableError(err)).toBe(false)
        const timeout = new Error('The operation was aborted due to timeout')
        timeout.name = 'TimeoutError'
        expect(isProxyUnreachableError(timeout)).toBe(true)
        const refused = new TypeError('fetch failed')
        Object.assign(refused, { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) })
        expect(isProxyUnreachableError(refused)).toBe(true)
    })
})

describe('corrupt mocks.json while the proxy is running', () => {
    it('prints the raw API 409 body, exits 1, and does not modify the file', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeFileSync(file, JSON.stringify({ nextId: 3, rules: [rule(1, 'keep'), rule(2, 'also')] }, null, 2))
        const { base, port } = await startProxy(home)
        const broken = corruptMocks()
        writeFileSync(file, broken)
        const before = readFileSync(file)

        const probe = await fetch(`${base}/api/mocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'A', urlPattern: 'a.test', body: 'a' }),
        })
        expect(probe.status).toBe(409)
        const apiBody = await probe.text()
        expect(apiBody).toContain('"code":"MOCKS_FILE_INVALID"')
        expect(apiBody).toContain('已禁止写入以免覆盖')
        expect(readFileSync(file).equals(before)).toBe(true)

        for (const args of MUTATIONS) {
            const { code, stdout, stderr } = await runCli(args, home, port)
            expect(code, `${args.join(' ')} stderr=${stderr}`).toBe(1)
            expect(stderr.trim(), args.join(' ')).toBe(apiBody.trim())
            expect(stdout.trim(), args.join(' ')).toBe('')
            expect(readFileSync(file).equals(before), args.join(' ')).toBe(true)
        }
    }, 45_000)

    it('mock list and mock list --json exit 1 and never print []', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        const broken = corruptMocks()
        writeFileSync(file, broken)
        const { base, port } = await startProxy(home)
        const status = await (await fetch(`${base}/api/mocks-file`)).json() as { valid: boolean; error: string }
        expect(status.valid).toBe(false)
        expect(status.error.startsWith(`Mock 文件格式错误: ${file}`)).toBe(true)
        const before = readFileSync(file)

        for (const args of [['mock', 'list'], ['mock', 'list', '--json']]) {
            const { code, stdout, stderr } = await runCli(args, home, port)
            expect(code, stderr).toBe(1)
            expect(stderr.trim()).toBe(status.error)
            expect(stdout.trim()).not.toBe('[]')
            expect(stdout.trim()).toBe('')
            expect(readFileSync(file).equals(before)).toBe(true)
        }
    }, 30_000)
})

describe('corrupt mocks.json while the proxy is not running', () => {
    it('refuses the write with ✗, exits 1, and leaves the file byte-for-byte', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        const broken = corruptMocks()
        writeFileSync(file, broken)
        const before = readFileSync(file)
        const port = await reservePort()
        const expected = writeRefusal(file, broken)

        for (const args of MUTATIONS) {
            const { code, stdout, stderr } = await runCli(args, home, port)
            expect(code, `${args.join(' ')} stderr=${stderr}`).toBe(1)
            expect(stderr).toContain('✗')
            expect(stderr).toContain(expected)
            expect(stdout.trim()).toBe('')
            expect(readFileSync(file).equals(before), args.join(' ')).toBe(true)
        }
    }, 30_000)

    it('mock list and mock list --json exit 1 and do not print []', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        const broken = corruptMocks()
        writeFileSync(file, broken)
        const before = readFileSync(file)
        const port = await reservePort()
        const expected = listRefusal(file, broken)

        for (const args of [['mock', 'list'], ['mock', 'list', '--json']]) {
            const { code, stdout, stderr } = await runCli(args, home, port)
            expect(code, `${args.join(' ')} stderr=${stderr}`).toBe(1)
            expect(stderr.trim()).toBe(expected)
            expect(expected.startsWith(`Mock 文件格式错误: ${file}`)).toBe(true)
            expect(stdout.trim()).not.toBe('[]')
            expect(stdout.trim()).toBe('')
            expect(readFileSync(file).equals(before)).toBe(true)
        }
    }, 20_000)

    it('still writes a valid file and warns that a restart is required', async () => {
        const home = makeHome()
        const file = join(home, 'mocks.json')
        writeFileSync(file, JSON.stringify({ nextId: 2, rules: [rule(1, 'keep')] }, null, 2))
        const port = await reservePort()

        const { code, stdout, stderr } = await runCli(
            ['mock', 'add', '--name', 'A', '--pattern', 'a.test', '--body', 'a'],
            home,
            port,
        )
        expect(code, stderr).toBe(0)
        expect(stderr).toContain('could not connect to a running proxy')
        expect(stderr).toContain('restart required for changes to take effect')
        expect(stdout).toMatch(/Mock Rule Added/)
        const onDisk = JSON.parse(readFileSync(file, 'utf8'))
        expect(onDisk.rules.map((r: { name: string }) => r.name).sort()).toEqual(['A', 'keep'])

        const listed = await runCli(['mock', 'list', '--json'], home, port)
        expect(listed.code, listed.stderr).toBe(0)
        expect(JSON.parse(listed.stdout).map((r: { name: string }) => r.name).sort()).toEqual(['A', 'keep'])
    }, 20_000)
})

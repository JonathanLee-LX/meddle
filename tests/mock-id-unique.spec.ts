import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createMockRule, deleteMockRule } from '../server/mocks'
import { ensureUniqueMockRuleIds, nextMockRuleId } from '../core/mock-utils'

/**
 * Issue #115: creating mock rules must always yield a fresh, unique id and
 * never overwrite an existing rule — via HTTP API (Web UI / MCP / CLI all go
 * through POST /api/mocks), CLI file mode, and after loading persisted data.
 */

const repoRoot = join(__dirname, '..')
const children: ChildProcessWithoutNullStreams[] = []
const homes: string[] = []

afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child)
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-115-'))
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

async function startProxy(home: string): Promise<{ base: string; port: number; child: ChildProcessWithoutNullStreams }> {
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
            if (res.ok) return { base, port, child }
        } catch (_) { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
}

async function apiCreate(base: string, body: Record<string, unknown>): Promise<{ id: number; name: string }> {
    const res = await fetch(`${base}/api/mocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const data = await res.json() as { status: string; rule: { id: number; name: string } }
    expect(data.status).toBe('success')
    return data.rule
}

async function apiList(base: string): Promise<Array<{ id: number; name: string }>> {
    const res = await fetch(`${base}/api/mocks`)
    return await res.json() as Array<{ id: number; name: string }>
}

// Pin the CLI to one port (MEDDLE_SESSION_PORT is exclusive) so it can never
// fall back to a real proxy on the default port.
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
        child.on('exit', (code) => resolve({ code, stdout, stderr }))
    })
}

function rule(id: number, name: string) {
    return {
        id, name, urlPattern: `/${name}`, query: '', method: '*', statusCode: 200, delay: 0,
        bodyType: 'inline', headers: {}, body: '', enabled: true,
    }
}

const names = (rules: Array<{ name: string }>) => rules.map((r) => r.name).sort()

describe('mock id helpers (issue #115)', () => {
    it('nextMockRuleId stays above existing ids even with a stale sequence', () => {
        expect(nextMockRuleId([], undefined)).toBe(1)
        expect(nextMockRuleId([rule(1, 'a'), rule(5, 'b')], 1)).toBe(6)
        expect(nextMockRuleId([rule(1, 'a')], 9)).toBe(9)
    })

    it('ensureUniqueMockRuleIds re-ids duplicates instead of dropping them', () => {
        const { rules, reassigned } = ensureUniqueMockRuleIds([rule(1, 'a'), rule(1, 'b'), rule(2, 'c'), { ...rule(0, 'd'), id: undefined as any }])
        expect(reassigned).toBe(2)
        expect(names(rules)).toEqual(['a', 'b', 'c', 'd'])
        expect(new Set(rules.map((r) => r.id)).size).toBe(4)
        // last duplicate keeps the id (same winner as the old lossy dedupe)
        expect(rules.find((r) => r.name === 'b')!.id).toBe(1)
        expect(rules.find((r) => r.name === 'a')!.id).toBeGreaterThan(2)
    })
})

describe('createMockRule (API / Web UI / agent tools path, in-process)', () => {
    function makeCtx(overrides: Record<string, unknown> = {}) {
        return {
            mockRules: [] as any[], mockIdSeq: 1,
            saveMockRules() {}, broadcastToAllClients() {},
            ...overrides,
        } as any
    }

    it('never reuses an id when the sequence is stale (the #115 race)', () => {
        const ctx = makeCtx()
        const a = createMockRule(ctx, { name: 'a', urlPattern: '/a' })
        ctx.mockIdSeq = 1 // simulate the stale copy that caused #115
        const b = createMockRule(ctx, { name: 'b', urlPattern: '/b' })
        ctx.mockIdSeq = 1
        const c = createMockRule(ctx, { name: 'c', urlPattern: '/c' })
        expect([a.id, b.id, c.id]).toEqual([1, 2, 3])
        expect(names(ctx.mockRules)).toEqual(['a', 'b', 'c'])
    })

    it('ignores a client-supplied id on create', () => {
        const ctx = makeCtx({ mockRules: [rule(1, 'keep')], mockIdSeq: 2 })
        const created = createMockRule(ctx, { id: 1, name: 'new', urlPattern: '/n' } as any)
        expect(created.id).toBe(2)
        expect(names(ctx.mockRules)).toEqual(['keep', 'new'])
    })

    it('does not reuse the id of a deleted rule', () => {
        const ctx = makeCtx()
        createMockRule(ctx, { name: 'a', urlPattern: '/a' })
        const b = createMockRule(ctx, { name: 'b', urlPattern: '/b' })
        deleteMockRule(ctx, b.id)
        const c = createMockRule(ctx, { name: 'c', urlPattern: '/c' })
        expect(c.id).toBeGreaterThan(b.id)
    })
})

describe('HTTP API against a real proxy (issue #115)', () => {
    it('back-to-back creates get unique ids and none are lost', async () => {
        const home = makeHome()
        const { base } = await startProxy(home)
        const sequential = []
        for (const name of ['A', 'B', 'C']) sequential.push(await apiCreate(base, { name, urlPattern: `/${name}` }))
        const parallel = await Promise.all(['D', 'E', 'F'].map((name) => apiCreate(base, { name, urlPattern: `/${name}` })))
        const ids = [...sequential, ...parallel].map((r) => r.id)
        expect(new Set(ids).size).toBe(6)
        const listed = await apiList(base)
        expect(names(listed)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
        const onDisk = JSON.parse(readFileSync(join(home, 'mocks.json'), 'utf8'))
        expect(names(onDisk.rules)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
        expect(onDisk.nextId).toBeGreaterThan(Math.max(...ids))
    }, 30_000)

    it('client-supplied id does not overwrite; delete then create does not reuse ids', async () => {
        const home = makeHome()
        const { base } = await startProxy(home)
        const a = await apiCreate(base, { name: 'A', urlPattern: '/A' })
        const b = await apiCreate(base, { id: a.id, name: 'B', urlPattern: '/B' })
        expect(b.id).not.toBe(a.id)
        await fetch(`${base}/api/mocks/${b.id}`, { method: 'DELETE' })
        const c = await apiCreate(base, { name: 'C', urlPattern: '/C' })
        expect(c.id).toBeGreaterThan(b.id)
        expect(names(await apiList(base))).toEqual(['A', 'C'])
    }, 30_000)

    it('loads persisted rules (stale nextId + duplicate ids) without loss, then creates without collision', async () => {
        const home = makeHome()
        writeFileSync(join(home, 'mocks.json'), JSON.stringify({
            nextId: 2, // stale: lower than stored ids
            rules: [rule(1, 'one'), rule(3, 'three'), rule(3, 'three-dup'), rule(7, 'seven')],
        }, null, 2))
        const { base } = await startProxy(home)
        const loaded = await apiList(base)
        expect(names(loaded)).toEqual(['one', 'seven', 'three', 'three-dup'])
        expect(new Set(loaded.map((r) => r.id)).size).toBe(4)
        const created = await Promise.all(['x', 'y'].map((name) => apiCreate(base, { name, urlPattern: `/${name}` })))
        const all = await apiList(base)
        expect(names(all)).toEqual(['one', 'seven', 'three', 'three-dup', 'x', 'y'])
        expect(new Set(all.map((r) => r.id)).size).toBe(6)
        for (const r of created) expect(loaded.map((l) => l.id)).not.toContain(r.id)
    }, 30_000)

    it('CLI `mock add` against a running proxy keeps every rule', async () => {
        const home = makeHome()
        const { base, port } = await startProxy(home)
        for (const name of ['cli-a', 'cli-b', 'cli-c']) {
            const { code, stdout, stderr } = await runCli(['mock', 'add', '--name', name, '--pattern', `/${name}`, '--json'], home, port)
            expect(code, stderr).toBe(0)
            expect(JSON.parse(stdout).fileOnly).toBeUndefined()
        }
        const listed = await apiList(base)
        expect(names(listed)).toEqual(['cli-a', 'cli-b', 'cli-c'])
        expect(new Set(listed.map((r) => r.id)).size).toBe(3)
    }, 45_000)
})

describe('CLI file mode (proxy not running)', () => {
    it('adds unique ids, honours persisted nextId and does not reuse deleted ids', async () => {
        const home = makeHome()
        const deadPort = await reservePort()
        writeFileSync(join(home, 'mocks.json'), JSON.stringify({ nextId: 10, rules: [rule(4, 'old')] }, null, 2))
        const ids: number[] = []
        for (const name of ['f1', 'f2']) {
            const { code, stdout, stderr } = await runCli(['mock', 'add', '--name', name, '--pattern', `/${name}`, '--json'], home, deadPort)
            expect(code, stderr).toBe(0)
            ids.push(JSON.parse(stdout).id)
        }
        expect(ids).toEqual([10, 11])
        const del = await runCli(['mock', 'delete', '11'], home, deadPort)
        expect(del.code, del.stderr).toBe(0)
        const again = await runCli(['mock', 'add', '--name', 'f3', '--pattern', '/f3', '--json'], home, deadPort)
        expect(JSON.parse(again.stdout).id).toBe(12)
        const onDisk = JSON.parse(readFileSync(join(home, 'mocks.json'), 'utf8'))
        expect(names(onDisk.rules)).toEqual(['f1', 'f3', 'old'])
        expect(onDisk.nextId).toBe(13)
    }, 45_000)
})

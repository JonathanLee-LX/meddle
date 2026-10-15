import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as tsEdit from '../core/rule-file-edit'
import { parseEprcWithExclusions } from '../helpers'
import { createAgentTools } from '../server/agent/tools'
import type { ServerContext } from '../server/index'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jsEdit = require('../bin/lib/rule-file-edit')

/**
 * Issue #145: rule writes (CLI, MCP, built-in Agent) used to rebuild the whole
 * rule file from a ruleMap, dropping comments, blank lines, disabled rules and
 * (CLI) every other rule's `!exclusions`. Every write must now leave all other
 * lines byte-identical and keep the edited rule's own exclusions.
 */

const repoRoot = join(__dirname, '..')

// Full-line comments, an indented comment, blank lines, a disabled (`//`) rule,
// exclusions on several rules, a [marker] rule, a multi-pattern line, odd spacing.
const FIXTURE = [
    '# 联调',
    'api.example.com !/api http://localhost:5173',
    '',
    '  # 缩进的注释',
    '// disabled.example.com 127.0.0.1:9000',
    'cdn.example.com/[assets] !/assets/legacy https://localhost:13001',
    'multi-a.example.com multi-b.example.com !/health 127.0.0.1:4000',
    '   indented.example.com    !/skip   127.0.0.1:4100   ',
    '',
    'edit.example.com !/keep 127.0.0.1:3000',
    '# 末尾注释',
    '',
].join('\n')

/** FIXTURE with line `index` replaced by `lines` (empty array = removed). */
function withLine(index: number, lines: string[], base = FIXTURE): string {
    const all = base.split('\n')
    all.splice(index, 1, ...lines)
    return all.join('\n')
}
const EDIT_LINE = 9
const appended = (line: string) => `${FIXTURE}${line}\n`

const impls = [
    ['bin/lib/rule-file-edit.js', jsEdit],
    ['core/rule-file-edit.ts', tsEdit],
] as const

describe.each(impls)('line-preserving rule edits — %s', (_name, edit) => {
    it('add appends a new rule and leaves every existing line untouched', () => {
        const result = edit.addRouteRule(FIXTURE, { pattern: 'new.example.com', target: '127.0.0.1:5000' })
        expect(result.existed).toBe(false)
        expect(result.content).toBe(appended('new.example.com 127.0.0.1:5000'))
        const withExcl = edit.addRouteRule(FIXTURE, { pattern: 'new.example.com', target: '127.0.0.1:5000', exclusions: ['/a', '/b'] })
        expect(withExcl.content).toBe(appended('new.example.com !/a !/b 127.0.0.1:5000'))
    })

    it('add without a trailing newline, into an empty file, and with CRLF line endings', () => {
        expect(edit.addRouteRule('a.com 1.1.1.1', { pattern: 'b.com', target: '2.2.2.2' }).content).toBe('a.com 1.1.1.1\nb.com 2.2.2.2')
        expect(edit.addRouteRule('', { pattern: 'b.com', target: '2.2.2.2' }).content).toBe('b.com 2.2.2.2')
        const crlf = FIXTURE.replace(/\n/g, '\r\n')
        expect(edit.addRouteRule(crlf, { pattern: 'b.com', target: '2.2.2.2' }).content).toBe(`${crlf}b.com 2.2.2.2\r\n`)
    })

    it('add of an existing pattern overwrites its target in place and keeps its own exclusions', () => {
        const result = edit.addRouteRule(FIXTURE, { pattern: 'edit.example.com', target: '127.0.0.1:3999' })
        expect(result.existed).toBe(true)
        expect(result.content).toBe(withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3999']))
        // Explicit exclusions replace them; [] clears them.
        expect(edit.addRouteRule(FIXTURE, { pattern: 'edit.example.com', target: '127.0.0.1:3999', exclusions: ['/x'] }).content)
            .toBe(withLine(EDIT_LINE, ['edit.example.com !/x 127.0.0.1:3999']))
        expect(edit.addRouteRule(FIXTURE, { pattern: 'edit.example.com', target: '127.0.0.1:3999', exclusions: [] }).content)
            .toBe(withLine(EDIT_LINE, ['edit.example.com 127.0.0.1:3999']))
    })

    it('update changes only the edited line, keeping its exclusions, spacing and [marker]', () => {
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'edit.example.com', target: '127.0.0.1:3001' }))
            .toEqual({ found: true, content: withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3001']) })
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'indented.example.com', target: '127.0.0.1:4199' }).content)
            .toBe(withLine(7, ['   indented.example.com    !/skip   127.0.0.1:4199   ']))
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'cdn.example.com/[assets]', target: 'https://localhost:14001' }).content)
            .toBe(withLine(5, ['cdn.example.com/[assets] !/assets/legacy https://localhost:14001']))
        // The marker-less spelling finds the same rule and keeps the marker.
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'cdn.example.com/assets', target: 'https://localhost:14001' }).content)
            .toBe(withLine(5, ['cdn.example.com/[assets] !/assets/legacy https://localhost:14001']))
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'edit.example.com', exclusions: [] }).content)
            .toBe(withLine(EDIT_LINE, ['edit.example.com 127.0.0.1:3000']))
    })

    it('update of one pattern on a multi-pattern line splits it, keeping order and the others as they were', () => {
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'multi-b.example.com', target: '127.0.0.1:4001' }).content)
            .toBe(withLine(6, ['multi-a.example.com !/health 127.0.0.1:4000', 'multi-b.example.com !/health 127.0.0.1:4001']))
    })

    it('update / delete report a missing pattern and never touch disabled rules', () => {
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'nope.example.com', target: 'x' })).toEqual({ found: false, content: FIXTURE })
        expect(edit.updateRouteRule(FIXTURE, { pattern: 'disabled.example.com', target: 'x' })).toEqual({ found: false, content: FIXTURE })
        expect(edit.deleteRouteRule(FIXTURE, { pattern: 'disabled.example.com' })).toEqual({ found: false, content: FIXTURE })
    })

    it('delete removes only the rule (whole line, or just its pattern on a shared line)', () => {
        expect(edit.deleteRouteRule(FIXTURE, { pattern: 'edit.example.com' }))
            .toEqual({ found: true, content: withLine(EDIT_LINE, []) })
        expect(edit.deleteRouteRule(FIXTURE, { pattern: 'multi-b.example.com' }).content)
            .toBe(withLine(6, ['multi-a.example.com !/health 127.0.0.1:4000']))
        expect(edit.deleteRouteRule(FIXTURE, { pattern: 'multi-a.example.com' }).content)
            .toBe(withLine(6, ['multi-b.example.com !/health 127.0.0.1:4000']))
        expect(edit.deleteRouteRule(FIXTURE, { pattern: 'cdn.example.com/assets' }).content).toBe(withLine(5, []))
        expect(edit.deleteRouteRule('a.com 1\r\nb.com 2', { pattern: 'b.com' }).content).toBe('a.com 1')
    })

    it('edits parse back to the intended rules (the router sees what was asked)', () => {
        const next = edit.updateRouteRule(FIXTURE, { pattern: 'multi-b.example.com', target: '127.0.0.1:4001' }).content
        const { ruleMap, excludeMap } = parseEprcWithExclusions(next)
        expect(ruleMap['multi-a.example.com']).toBe('127.0.0.1:4000')
        expect(ruleMap['multi-b.example.com']).toBe('127.0.0.1:4001')
        expect(excludeMap['multi-b.example.com']).toEqual(['/health'])
        expect(excludeMap['api.example.com']).toEqual(['/api'])
    })
})

// ---------- real CLI / proxy / MCP ----------

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

function makeHome(offline: boolean): string {
    const home = mkdtempSync(join(tmpdir(), 'meddle-145-'))
    homes.push(home)
    mkdirSync(join(home, 'route-rules'), { recursive: true })
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ activeRuleFiles: ['dev'] }, null, 2))
    // File mode: point the CLI at a dead port so it never finds a proxy.
    if (offline) writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({ proxyUrl: 'http://127.0.0.1:1' }))
    return home
}

const rulePath = (home: string) => join(home, 'route-rules', 'dev.txt')
const resetRules = (home: string) => writeFileSync(rulePath(home), FIXTURE)
const readRules = (home: string) => readFileSync(rulePath(home), 'utf8')

async function reservePort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function startProxy(home: string): Promise<string> {
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
            if (res.ok && existsSync(join(home, 'mcp-proxy-url.json'))) return base
        } catch { /* not up yet */ }
        await delay(50)
    }
    throw new Error(`proxy did not start: ${output.join('')}`)
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

/** [cli args, expected file content] for add / update / delete. */
const CLI_CASES: Array<[string, string[], string]> = [
    ['add new rule', ['route', 'add', 'dev', 'new.example.com', '127.0.0.1:5000'], appended('new.example.com 127.0.0.1:5000')],
    ['add with exclusions in the pattern argument', ['route', 'add', 'dev', 'new.example.com !/api', '127.0.0.1:5000'], appended('new.example.com !/api 127.0.0.1:5000')],
    ['add over an existing rule keeps its exclusions', ['route', 'add', 'dev', 'edit.example.com', '127.0.0.1:3999'], withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3999'])],
    ['update keeps the rule\'s exclusions', ['route', 'update', 'dev', 'edit.example.com', '127.0.0.1:3001'], withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3001'])],
    ['update a [marker] rule', ['route', 'update', 'dev', 'cdn.example.com/[assets]', 'https://localhost:14001'], withLine(5, ['cdn.example.com/[assets] !/assets/legacy https://localhost:14001'])],
    ['delete a rule', ['route', 'delete', 'dev', 'edit.example.com'], withLine(EDIT_LINE, [])],
    ['delete one pattern of a shared line', ['route', 'delete', 'dev', 'multi-b.example.com'], withLine(6, ['multi-a.example.com !/health 127.0.0.1:4000'])],
]

describe('CLI route add / update / delete keep other lines byte-identical (issue #145)', () => {
    describe('file mode (no proxy)', () => {
        let home: string
        beforeAll(() => { home = makeHome(true) })

        it.each(CLI_CASES)('%s', async (_label, args, expected) => {
            resetRules(home)
            const { code, stderr } = await runCli([...args, '--json'], home)
            expect(code, stderr).toBe(0)
            expect(readRules(home)).toBe(expected)
        }, 30_000)

        it('a missing pattern fails and leaves the file unchanged', async () => {
            resetRules(home)
            for (const cmd of ['update', 'delete']) {
                const args = cmd === 'update' ? ['route', cmd, 'dev', 'disabled.example.com', 'x'] : ['route', cmd, 'dev', 'disabled.example.com']
                const { code } = await runCli(args, home)
                expect(code).toBe(1)
                expect(readRules(home)).toBe(FIXTURE)
            }
        }, 30_000)
    })

    describe('proxy running (HTTP API path)', () => {
        let home: string
        beforeAll(async () => {
            home = makeHome(false)
            resetRules(home)
            await startProxy(home)
        }, 30_000)

        it.each(CLI_CASES)('%s', async (_label, args, expected) => {
            resetRules(home)
            const { code, stdout, stderr } = await runCli([...args, '--json'], home)
            expect(code, stderr).toBe(0)
            // Went through the running proxy, not the file-mode fallback.
            expect(JSON.parse(stdout).fileOnly).toBeUndefined()
            expect(readRules(home)).toBe(expected)
        }, 30_000)
    })
})

describe('MCP route_rule_add / update / delete keep other lines byte-identical (issue #145)', () => {
    let home: string
    let client: Client

    beforeAll(async () => {
        home = makeHome(false)
        resetRules(home)
        await startProxy(home)
        client = new Client({ name: 'meddle-145-test', version: '0.0.0' })
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [join(repoRoot, 'mcp-server.js')],
            env: { ...process.env, MEDDLE_HOME: home } as Record<string, string>,
            stderr: 'ignore',
        }))
    }, 30_000)

    afterAll(async () => { await client?.close() })

    const MCP_CASES: Array<[string, { name: string; arguments: Record<string, unknown> }, string]> = [
        ['add new rule', { name: 'route_rule_add', arguments: { ruleFile: 'dev', pattern: 'new.example.com', target: '127.0.0.1:5000' } }, appended('new.example.com 127.0.0.1:5000')],
        ['add new rule with exclusions', { name: 'route_rule_add', arguments: { ruleFile: 'dev', pattern: 'new.example.com', target: '127.0.0.1:5000', exclusions: ['/api'] } }, appended('new.example.com !/api 127.0.0.1:5000')],
        ['add over an existing rule keeps its exclusions', { name: 'route_rule_add', arguments: { ruleFile: 'dev', pattern: 'edit.example.com', target: '127.0.0.1:3999' } }, withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3999'])],
        ['update target keeps exclusions', { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'edit.example.com', newTarget: '127.0.0.1:3001' } }, withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3001'])],
        ['update exclusions only', { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'edit.example.com', exclusions: ['/a', '/b'] } }, withLine(EDIT_LINE, ['edit.example.com !/a !/b 127.0.0.1:3000'])],
        ['update one pattern of a shared line', { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'multi-a.example.com', newTarget: '127.0.0.1:4001' } }, withLine(6, ['multi-a.example.com !/health 127.0.0.1:4001', 'multi-b.example.com !/health 127.0.0.1:4000'])],
        ['delete a rule', { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'edit.example.com' } }, withLine(EDIT_LINE, [])],
        ['delete a [marker] rule', { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'cdn.example.com/[assets]' } }, withLine(5, [])],
    ]

    it.each(MCP_CASES)('%s', async (_label, call, expected) => {
        resetRules(home)
        const result: any = await client.callTool(call)
        expect(result.isError, JSON.stringify(result)).toBeFalsy()
        expect(readRules(home)).toBe(expected)
    }, 30_000)

    it('a missing pattern is an error and leaves the file unchanged', async () => {
        resetRules(home)
        for (const call of [
            { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'disabled.example.com', newTarget: 'x' } },
            { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'nope.example.com' } },
        ]) {
            const result: any = await client.callTool(call)
            expect(result.isError).toBe(true)
        }
        expect(readRules(home)).toBe(FIXTURE)
    })
})

describe('built-in Agent route tools keep other lines byte-identical (issue #145)', () => {
    function agentContext() {
        const home = mkdtempSync(join(tmpdir(), 'meddle-145-agent-'))
        homes.push(home)
        mkdirSync(join(home, 'route-rules'), { recursive: true })
        writeFileSync(join(home, 'route-rules', 'dev.txt'), FIXTURE)
        const settingsPath = join(home, 'settings.json')
        writeFileSync(settingsPath, JSON.stringify({ activeRuleFiles: ['dev'] }))
        const ctx = { meddleDir: home, settingsPath, reloadAllRuleFiles: vi.fn() } as unknown as ServerContext
        return { home, ctx }
    }

    const AGENT_CASES: Array<[string, string, Record<string, unknown>, string]> = [
        ['add new rule', 'route_rule_add', { ruleFile: 'dev', pattern: 'new.example.com', target: '127.0.0.1:5000' }, appended('new.example.com 127.0.0.1:5000')],
        ['add over an existing rule keeps its exclusions', 'route_rule_add', { ruleFile: 'dev', pattern: 'edit.example.com', target: '127.0.0.1:3999' }, withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3999'])],
        ['update target keeps exclusions', 'route_rule_update', { ruleFile: 'dev', pattern: 'edit.example.com', target: '127.0.0.1:3001' }, withLine(EDIT_LINE, ['edit.example.com !/keep 127.0.0.1:3001'])],
        ['delete a rule', 'route_rule_delete', { ruleFile: 'dev', pattern: 'edit.example.com' }, withLine(EDIT_LINE, [])],
    ]

    it.each(AGENT_CASES)('%s', async (_label, toolName, input, expected) => {
        const { home, ctx } = agentContext()
        const tool = createAgentTools().get(toolName)!
        await tool.execute(input, { serverContext: ctx })
        expect(readRules(home)).toBe(expected)
    })

    it('add over an existing rule reports the kept exclusions in its confirmation', async () => {
        const { ctx } = agentContext()
        const tool = createAgentTools().get('route_rule_add')!
        const confirmation: any = await tool.prepareConfirmation?.({ ruleFile: 'dev', pattern: 'edit.example.com', target: '127.0.0.1:3999' }, { serverContext: ctx })
        expect(confirmation.diff).toContain('- edit.example.com !/keep 127.0.0.1:3000')
        expect(confirmation.diff).toContain('+ edit.example.com !/keep 127.0.0.1:3999')
        expect(confirmation.preview.exclusions).toEqual(['/keep'])
    })
})

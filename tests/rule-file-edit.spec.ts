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

describe.each(impls)('UTF-8 BOM — %s', (_name, edit) => {
    const bom = '\uFEFF'
    const text = `${bom}first.example.com second.example.com !/f 127.0.0.1:1000\nother.example.com !/o 127.0.0.1:2000\n`

    it('a first-line pattern is still found and the BOM stays byte-identical', () => {
        expect(edit.updateRouteRule(text, { pattern: 'first.example.com', target: '127.0.0.1:1001' }).content)
            .toBe(`${bom}first.example.com !/f 127.0.0.1:1001\nsecond.example.com !/f 127.0.0.1:1000\nother.example.com !/o 127.0.0.1:2000\n`)
        expect(edit.addRouteRule(text, { pattern: 'second.example.com', target: '127.0.0.1:1002' }))
            .toEqual({ existed: true, content: `${bom}first.example.com !/f 127.0.0.1:1000\nsecond.example.com !/f 127.0.0.1:1002\nother.example.com !/o 127.0.0.1:2000\n` })
        expect(edit.addRouteRule(text, { pattern: 'new.example.com', target: '1' }).content).toBe(`${text}new.example.com 1\n`)
    })

    it('deleting the first line (or its first pattern) keeps the BOM at the start of the file', () => {
        const single = `${bom}first.example.com 127.0.0.1:1000\nother.example.com 127.0.0.1:2000`
        expect(edit.deleteRouteRule(single, { pattern: 'first.example.com' })).toEqual({ found: true, content: `${bom}other.example.com 127.0.0.1:2000` })
        expect(edit.deleteRouteRule(text, { pattern: 'first.example.com' }).content)
            .toBe(`${bom}second.example.com !/f 127.0.0.1:1000\nother.example.com !/o 127.0.0.1:2000\n`)
        expect(edit.deleteRouteRule(`${bom}only.example.com 1`, { pattern: 'only.example.com' }).content).toBe(bom)
        expect(edit.addRouteRule(bom, { pattern: 'a.com', target: '1' }).content).toBe(`${bom}a.com 1`)
    })
})

describe.each(impls)('split / delete safety and disabled duplicates — %s', (_name, edit) => {
    const MSG = '该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改'

    it('splitting the first line of a BOM file keeps the BOM only at the file start', () => {
        expect(edit.updateRouteRule('\uFEFFa.com b.com t1', { pattern: 'a.com', target: 'N' }).content).toBe('\uFEFFa.com N\nb.com t1')
        expect(edit.updateRouteRule('\uFEFFa.com b.com t1', { pattern: 'b.com', target: 'N' }).content).toBe('\uFEFFa.com t1\nb.com N')
        expect(edit.updateRouteRule('\uFEFF  a.com b.com t1\r\nc.com t2', { pattern: 'a.com', exclusions: ['/x'] }).content)
            .toBe('\uFEFF  a.com !/x t1\r\n  b.com t1\r\nc.com t2')
    })

    it.each([
        ['delete leaves //… at line start', (t: string) => edit.deleteRouteRule(t, { pattern: 'a.com' }), 'a.com //cdn.com t'],
        ['delete leaves #… at line start', (t: string) => edit.deleteRouteRule(t, { pattern: 'a.com' }), 'a.com #tag.com t'],
        ['update splits //… onto its own line', (t: string) => edit.updateRouteRule(t, { pattern: 'a.com', target: 'N' }), 'a.com //cdn.com t'],
        ['update of the //… pattern itself', (t: string) => edit.updateRouteRule(t, { pattern: '//cdn.com', target: 'N' }), 'a.com //cdn.com t'],
        ['add over an existing rule on such a line', (t: string) => edit.addRouteRule(t, { pattern: 'a.com', target: 'N' }), 'a.com #tag.com t'],
        ['exclusion change on such a line', (t: string) => edit.updateRouteRule(t, { pattern: 'a.com', exclusions: ['/x'] }), 'x.com 1\r\na.com #tag.com b.com t'],
    ] as Array<[string, (t: string) => unknown, string]>)('%s → error, nothing returned to write', (_label, run, line) => {
        expect(() => run(line)).toThrow(MSG)
        try { run(line) } catch (err: any) { expect(err.code).toBe('RULE_LINE_SPLIT_UNSAFE') }
    })

    it('a // or # pattern that stays behind a normal one is fine', () => {
        expect(edit.deleteRouteRule('a.com b.com //c t', { pattern: 'b.com' }).content).toBe('a.com //c t')
        expect(edit.updateRouteRule('a.com b.com //c t', { pattern: 'a.com', target: 'N' }).content).toBe('a.com N\nb.com //c t')
    })

    it('same pattern on an enabled line and a // disabled line: add updates the enabled line in place, does not append', () => {
        const text = 'dup.example.com !/e 127.0.0.1:1\n// dup.example.com 127.0.0.1:2\n'
        expect(edit.addRouteRule(text, { pattern: 'dup.example.com', target: '127.0.0.1:3' }))
            .toEqual({ existed: true, content: 'dup.example.com !/e 127.0.0.1:3\n// dup.example.com 127.0.0.1:2\n' })
    })

    it('pattern only on a // disabled line: add appends a new enabled line; the disabled one stays', () => {
        const text = '// dup.example.com 127.0.0.1:2\nx.com 1\n'
        expect(edit.addRouteRule(text, { pattern: 'dup.example.com', target: '127.0.0.1:3' }))
            .toEqual({ existed: false, content: `${text}dup.example.com 127.0.0.1:3\n` })
    })
})

// The CLI / MCP copy (JS) and the server copy (TS) must stay logically identical:
// run the same matrix of inputs and operations through both and compare.
describe('bin/lib/rule-file-edit.js and core/rule-file-edit.ts parity', () => {
    const bases: Record<string, string> = {
        lf: FIXTURE,
        crlf: FIXTURE.replace(/\n/g, '\r\n'),
        bom: `\uFEFF${FIXTURE}`,
        bomFirstRule: `\uFEFFfirst.example.com second.example.com !/f 1.1.1.1\r\n${FIXTURE}`,
        noTrailingNewline: FIXTURE.trimEnd(),
        empty: '',
        commentsOnly: '# a\n\n// b.com 1\n',
        duplicates: 'dup.example.com 1\nx.com 2\ndup.example.com !/d 3\n',
    }
    const patterns = ['api.example.com', 'edit.example.com', 'multi-a.example.com', 'multi-b.example.com', 'cdn.example.com/[assets]', 'cdn.example.com/assets',
        'indented.example.com', 'disabled.example.com', 'first.example.com', 'second.example.com', 'dup.example.com', 'missing.example.com']
    const variants: Array<{ target?: string; exclusions?: string[] }> = [
        { target: '127.0.0.1:7000' },
        { exclusions: [] },
        { exclusions: ['/n1', '/n2'] },
        { target: '127.0.0.1:7000', exclusions: ['/n'] },
    ]

    it('add / update / delete give the same result for every input', () => {
        let compared = 0
        for (const [baseName, base] of Object.entries(bases)) {
            for (const pattern of patterns) {
                const where = `${baseName} / ${pattern}`
                expect(tsEdit.deleteRouteRule(base, { pattern }), `delete ${where}`).toEqual(jsEdit.deleteRouteRule(base, { pattern }))
                compared++
                for (const v of variants) {
                    expect(tsEdit.updateRouteRule(base, { pattern, ...v }), `update ${where} ${JSON.stringify(v)}`).toEqual(jsEdit.updateRouteRule(base, { pattern, ...v }))
                    const add = { pattern, target: v.target ?? '127.0.0.1:7001', exclusions: v.exclusions }
                    expect(tsEdit.addRouteRule(base, add), `add ${where} ${JSON.stringify(v)}`).toEqual(jsEdit.addRouteRule(base, add))
                    compared += 2
                }
            }
        }
        expect(compared).toBe(Object.keys(bases).length * patterns.length * (1 + variants.length * 2))
    })

    it('patternKey and parseRuleLine agree', () => {
        for (const line of FIXTURE.split('\n').concat(['\uFEFFa.com 1', 'only-one-token', '!x a.com b'])) {
            expect(tsEdit.parseRuleLine(line), line).toEqual(jsEdit.parseRuleLine(line))
        }
        for (const token of ['a.com', 'cdn.com/[assets]', '^https://x[/api]']) {
            expect(tsEdit.patternKey(token)).toBe(jsEdit.patternKey(token))
        }
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
    // `locked` is a read-only ruleset (#137): every #145 write path must still refuse it.
    writeFileSync(join(home, 'route-rules', 'locked.txt'), BOM_FIXTURE)
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ activeRuleFiles: ['dev', 'locked'], readonlyRuleFiles: ['locked'] }, null, 2))
    // File mode: point the CLI at a dead port so it never finds a proxy.
    if (offline) writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({ proxyUrl: 'http://127.0.0.1:1' }))
    return home
}

const rulePath = (home: string, name = 'dev') => join(home, 'route-rules', `${name}.txt`)
const resetRules = (home: string, content = FIXTURE, name = 'dev') => writeFileSync(rulePath(home, name), content)
const readRules = (home: string, name = 'dev') => readFileSync(rulePath(home, name), 'utf8')
const ruleBytes = (home: string, name = 'dev') => readFileSync(rulePath(home, name))

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

// A UTF-8 BOM before a rule on the first line: the BOM stays byte-identical and
// the first-line pattern is still found.
const BOM = '\uFEFF'
const FIRST = 'first.example.com !/f 127.0.0.1:1000'
const BOM_FIXTURE = `${BOM}${FIRST}\n${FIXTURE}`
const BOM_CLI_CASES: Array<[string, string[], string]> = [
    ['BOM: add new rule', ['route', 'add', 'dev', 'new.example.com', '127.0.0.1:5000'], `${BOM_FIXTURE}new.example.com 127.0.0.1:5000\n`],
    ['BOM: update the first-line rule', ['route', 'update', 'dev', 'first.example.com', '127.0.0.1:1001'], `${BOM}first.example.com !/f 127.0.0.1:1001\n${FIXTURE}`],
    ['BOM: delete the first-line rule', ['route', 'delete', 'dev', 'first.example.com'], `${BOM}${FIXTURE}`],
]
/**
 * Compare RAW bytes on disk, not decoded strings: the file must start with
 * EF BB BF and every other byte must match the expected text.
 */
const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf])
function expectBomBytes(home: string, expected: string) {
    expect(expected.startsWith(BOM)).toBe(true)
    const actual = ruleBytes(home)
    expect([...actual.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const want = Buffer.concat([BOM_BYTES, Buffer.from(expected.slice(BOM.length), 'utf8')])
    expect(actual.equals(want), `${actual.toString('hex')}\n!=\n${want.toString('hex')}`).toBe(true)
}

const LOCKED_CLI_CASES: string[][] = [
    ['route', 'add', 'locked', 'new.example.com', '127.0.0.1:9'],
    ['route', 'add', 'locked', 'first.example.com', '127.0.0.1:9'],
    ['route', 'update', 'locked', 'first.example.com', '127.0.0.1:9'],
    ['route', 'delete', 'locked', 'first.example.com'],
]
const EXIT_RULESET_READONLY = 3

// BOM + CRLF fixture whose shared lines have a later pattern starting with // or #.
const SPLIT_UNSAFE_MESSAGE = '该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改'
const UNSAFE_FIXTURE = [
    '\uFEFF# 头部注释',
    'a.example.com //cdn.example.com !/x 127.0.0.1:1',
    '',
    'b.example.com #tag.example.com 127.0.0.1:2',
    'other.example.com !/o 127.0.0.1:3',
    '',
].join('\r\n')
const UNSAFE_CLI_CASES: string[][] = [
    ['route', 'delete', 'dev', 'a.example.com'],
    ['route', 'update', 'dev', 'a.example.com', '127.0.0.1:9'],
    ['route', 'add', 'dev', 'a.example.com', '127.0.0.1:9'],
    ['route', 'delete', 'dev', 'b.example.com'],
    ['route', 'update', 'dev', 'b.example.com !/new', '127.0.0.1:9'],
]

async function expectCliSplitRefused(home: string) {
    for (const args of UNSAFE_CLI_CASES) {
        resetRules(home, UNSAFE_FIXTURE)
        const before = ruleBytes(home)
        const { code, stdout, stderr } = await runCli(args, home)
        expect(code, args.join(' ')).not.toBe(0)
        expect(stdout + stderr, args.join(' ')).toContain(SPLIT_UNSAFE_MESSAGE)
        expect(ruleBytes(home).equals(before), args.join(' ')).toBe(true)
    }
}

async function expectCliLocked(home: string) {
    const before = ruleBytes(home, 'locked')
    for (const args of LOCKED_CLI_CASES) {
        const { code, stdout, stderr } = await runCli([...args, '--json'], home)
        expect(code, `${args.join(' ')}\n${stdout}${stderr}`).toBe(EXIT_RULESET_READONLY)
        expect(JSON.parse(stdout.trim()).error.code).toBe('RULESET_READONLY')
    }
    expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
}

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

        it.each(BOM_CLI_CASES)('%s', async (_label, args, expected) => {
            resetRules(home, BOM_FIXTURE)
            const { code, stderr } = await runCli([...args, '--json'], home)
            expect(code, stderr).toBe(0)
            expectBomBytes(home, expected)
        }, 30_000)

        it('a read-only ruleset is still refused (exit 3, file unchanged)', async () => {
            await expectCliLocked(home)
        }, 60_000)

        it('refuses to split a line when a // or # pattern would start a line (BOM + CRLF file unchanged)', async () => {
            await expectCliSplitRefused(home)
        }, 60_000)

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

        it.each(BOM_CLI_CASES)('%s', async (_label, args, expected) => {
            resetRules(home, BOM_FIXTURE)
            const { code, stdout, stderr } = await runCli([...args, '--json'], home)
            expect(code, stderr).toBe(0)
            expect(JSON.parse(stdout).fileOnly).toBeUndefined()
            expectBomBytes(home, expected)
        }, 30_000)

        it('a read-only ruleset is still refused (API 423 → exit 3, no file-mode fallback)', async () => {
            await expectCliLocked(home)
        }, 60_000)

        it('refuses to split a line when a // or # pattern would start a line (BOM + CRLF file unchanged)', async () => {
            await expectCliSplitRefused(home)
        }, 60_000)

        it('GET …/content serves the BOM bytes as stored on disk', async () => {
            resetRules(home, BOM_FIXTURE)
            const url = JSON.parse(readFileSync(join(home, 'mcp-proxy-url.json'), 'utf8')).proxyUrl
            const body = Buffer.from(await (await fetch(`${url}/api/rule-files/dev/content`)).arrayBuffer())
            expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
            expect(body.equals(ruleBytes(home))).toBe(true)
        })

        it('the table-view save path (PUT …/content) is refused with 423 for a read-only ruleset', async () => {
            const before = ruleBytes(home, 'locked')
            const url = JSON.parse(readFileSync(join(home, 'mcp-proxy-url.json'), 'utf8')).proxyUrl
            const res = await fetch(`${url}/api/rule-files/locked/content`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `${BOM_FIXTURE}x.example.com 1.1.1.1\n` }),
            })
            expect(res.status).toBe(423)
            expect((await res.json()).code).toBe('RULESET_READONLY')
            expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
        })
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

    it.each([
        ['BOM: add new rule', { name: 'route_rule_add', arguments: { ruleFile: 'dev', pattern: 'new.example.com', target: '127.0.0.1:5000' } }, `${BOM_FIXTURE}new.example.com 127.0.0.1:5000\n`],
        ['BOM: update the first-line rule', { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'first.example.com', newTarget: '127.0.0.1:1001' } }, `${BOM}first.example.com !/f 127.0.0.1:1001\n${FIXTURE}`],
        ['BOM: delete the first-line rule', { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'first.example.com' } }, `${BOM}${FIXTURE}`],
    ] as Array<[string, { name: string; arguments: Record<string, unknown> }, string]>)('%s', async (_label, call, expected) => {
        resetRules(home, BOM_FIXTURE)
        const result: any = await client.callTool(call)
        expect(result.isError, JSON.stringify(result)).toBeFalsy()
        expectBomBytes(home, expected)
    }, 30_000)

    it('a read-only ruleset is still refused with RULESET_READONLY (file unchanged)', async () => {
        const before = ruleBytes(home, 'locked')
        for (const call of [
            { name: 'route_rule_add', arguments: { ruleFile: 'locked', pattern: 'new.example.com', target: '127.0.0.1:9' } },
            { name: 'route_rule_update', arguments: { ruleFile: 'locked', pattern: 'first.example.com', newTarget: '127.0.0.1:9' } },
            { name: 'route_rule_delete', arguments: { ruleFile: 'locked', pattern: 'first.example.com' } },
        ]) {
            const result: any = await client.callTool(call)
            expect(result.isError, call.name).toBe(true)
            expect(JSON.parse(result.content[0].text).error.code).toBe('RULESET_READONLY')
        }
        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
    })

    it('refuses to split a line when a // or # pattern would start a line: isError + message, BOM + CRLF file unchanged', async () => {
        for (const call of [
            { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'a.example.com' } },
            { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'a.example.com', newTarget: '127.0.0.1:9' } },
            { name: 'route_rule_update', arguments: { ruleFile: 'dev', pattern: 'b.example.com', exclusions: ['/new'] } },
            { name: 'route_rule_add', arguments: { ruleFile: 'dev', pattern: 'b.example.com', target: '127.0.0.1:9' } },
            { name: 'route_rule_delete', arguments: { ruleFile: 'dev', pattern: 'b.example.com' } },
        ]) {
            resetRules(home, UNSAFE_FIXTURE)
            const before = ruleBytes(home)
            const result: any = await client.callTool(call)
            expect(result.isError, JSON.stringify(call)).toBe(true)
            expect(result.content.map((c: any) => c.text).join('\n')).toContain(SPLIT_UNSAFE_MESSAGE)
            expect(ruleBytes(home).equals(before), JSON.stringify(call)).toBe(true)
        }
    })

    it('tool descriptions say omitting exclusions keeps them and [] clears them', async () => {
        const { tools } = await client.listTools()
        for (const name of ['route_rule_add', 'route_rule_update']) {
            const tool: any = tools.find((t) => t.name === name)
            expect(tool.description, name).toContain('exclusions 不传时保留该规则原有的排除规则')
            expect(tool.description, name).toContain('传 [] 清空')
            const param = tool.inputSchema.properties.exclusions.description
            expect(param, name).toContain('不传时保留')
            expect(param, name).toContain('传 [] 清空')
        }
    })

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
        writeFileSync(join(home, 'route-rules', 'locked.txt'), BOM_FIXTURE)
        const settingsPath = join(home, 'settings.json')
        writeFileSync(settingsPath, JSON.stringify({ activeRuleFiles: ['dev', 'locked'], readonlyRuleFiles: ['locked'] }))
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

    it.each([
        ['BOM: add new rule', 'route_rule_add', { ruleFile: 'dev', pattern: 'new.example.com', target: '127.0.0.1:5000' }, `${BOM_FIXTURE}new.example.com 127.0.0.1:5000\n`],
        ['BOM: update the first-line rule', 'route_rule_update', { ruleFile: 'dev', pattern: 'first.example.com', target: '127.0.0.1:1001' }, `${BOM}first.example.com !/f 127.0.0.1:1001\n${FIXTURE}`],
        ['BOM: delete the first-line rule', 'route_rule_delete', { ruleFile: 'dev', pattern: 'first.example.com' }, `${BOM}${FIXTURE}`],
    ] as Array<[string, string, Record<string, unknown>, string]>)('%s', async (_label, toolName, input, expected) => {
        const { home, ctx } = agentContext()
        resetRules(home, BOM_FIXTURE)
        await createAgentTools().get(toolName)!.execute(input, { serverContext: ctx })
        expectBomBytes(home, expected)
    })

    it('a read-only ruleset is still refused with RULESET_READONLY (file unchanged)', async () => {
        const { home, ctx } = agentContext()
        const before = ruleBytes(home, 'locked')
        const tools = createAgentTools()
        const run = (fn: () => unknown) => Promise.resolve().then(fn)
        for (const [name, input] of [
            ['route_rule_add', { ruleFile: 'locked', pattern: 'new.example.com', target: '127.0.0.1:9' }],
            ['route_rule_update', { ruleFile: 'locked', pattern: 'first.example.com', target: '127.0.0.1:9' }],
            ['route_rule_delete', { ruleFile: 'locked', pattern: 'first.example.com' }],
        ] as Array<[string, Record<string, unknown>]>) {
            await expect(run(() => tools.get(name)!.execute(input, { serverContext: ctx })), name).rejects.toMatchObject({ code: 'RULESET_READONLY' })
        }
        expect(ruleBytes(home, 'locked').equals(before)).toBe(true)
    })

    it('refuses to split a line when a // or # pattern would start a line (file unchanged)', async () => {
        const { home, ctx } = agentContext()
        resetRules(home, UNSAFE_FIXTURE)
        const before = ruleBytes(home)
        const tools = createAgentTools()
        const run = (fn: () => unknown) => Promise.resolve().then(fn)
        for (const [name, input] of [
            ['route_rule_delete', { ruleFile: 'dev', pattern: 'a.example.com' }],
            ['route_rule_update', { ruleFile: 'dev', pattern: 'a.example.com', target: '127.0.0.1:9' }],
            ['route_rule_add', { ruleFile: 'dev', pattern: 'b.example.com', target: '127.0.0.1:9' }],
        ] as Array<[string, Record<string, unknown>]>) {
            await expect(run(() => tools.get(name)!.prepareConfirmation!(input, { serverContext: ctx })), name).rejects.toThrow(SPLIT_UNSAFE_MESSAGE)
            await expect(run(() => tools.get(name)!.execute(input, { serverContext: ctx })), name).rejects.toThrow(SPLIT_UNSAFE_MESSAGE)
        }
        expect(ruleBytes(home).equals(before)).toBe(true)
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

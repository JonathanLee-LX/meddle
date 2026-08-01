import { afterEach, describe, expect, it } from 'vitest'
import { isAbsolute, basename } from 'path'
import { buildProxySpawn, buildCliSpawn, getReentryArgv, __setReentryOverrideForTest } from '../bin/lib/spawn-proxy'

// SUT: bin/lib/spawn-proxy.js (plain JS, sibling to existing bin/lib/*.js).
//
// Contract: a meddle self-spawn must RE-ENTER the meddle entrypoint correctly in
// BOTH runtime contexts:
//   - Binary (deno compile): process.execPath IS the meddle binary, which reads
//     MEDDLE_ENTRY and dispatches. Reentry argv is [] (no script path).
//   - npm/node: process.execPath is plain `node`, which needs a script path to
//     bin/main.js, which then dispatches via MEDDLE_ENTRY. Reentry argv is [mainPath].
// buildProxySpawn is PURE: reentryArgv is INJECTED (never reads process), so the
// contract is deterministic. getReentryArgv() is the small process-coupled helper
// that callers use to produce the right reentryArgv for the current context.
//
// Pure baseEnv injection keeps the env contract free of host-env leakage
// (tdd skill: "don't depend on process.env").

afterEach(() => { __setReentryOverrideForTest(undefined) })

describe('bin/lib/spawn-proxy — env-based proxy self-spawn (M1)', () => {
    it('binary form (reentryArgv=[]): args is just extraArgv, no script path', () => {
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [] })
        expect(out.args).toEqual([])
    })

    it('always sets MEDDLE_ENTRY=proxy in the child env (binary identity lives in env, not argv)', () => {
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [] })
        expect(out.options.env.MEDDLE_ENTRY).toBe('proxy')
    })

    it('lets extraEnv override baseEnv keys (caller intent wins)', () => {
        const out = buildProxySpawn({
            baseEnv: { MEDDLE_MCP: '0', PATH: 'x' },
            reentryArgv: [],
            extraEnv: { MEDDLE_MCP: '1' },
        })
        expect(out.options.env.MEDDLE_MCP).toBe('1')
        expect(out.options.env.PATH).toBe('x')
    })

    it('forwards extraArgv after reentryArgv verbatim (e.g. supervise proxyArgs)', () => {
        const out = buildProxySpawn({
            baseEnv: {}, reentryArgv: [],
            extraArgv: ['--remote', '--remote-token', 't'],
        })
        expect(out.args).toEqual(['--remote', '--remote-token', 't'])
    })

    it('is env-isolated: baseEnv={} + reentryArgv=[] yields env containing only MEDDLE_ENTRY', () => {
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [] })
        expect(Object.keys(out.options.env)).toEqual(['MEDDLE_ENTRY'])
    })

    it('node form (reentryArgv=[main.js]): prepends the reentry path to args', () => {
        const mainPath = '/repo/bin/main.js'
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [mainPath], extraArgv: ['--open'] })
        expect(out.args).toEqual([mainPath, '--open'])
    })

    it('models start_proxy (mcp-server): MEDDLE_MCP=1, binary reentry, empty extraArgv', () => {
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [], extraEnv: { MEDDLE_MCP: '1' } })
        expect(out.args).toEqual([])
        expect(out.options.env).toMatchObject({ MEDDLE_ENTRY: 'proxy', MEDDLE_MCP: '1' })
    })

    it('models create_session (mcp-server): MEDDLE_HOME/PORT/SESSION_ID/HEADLESS all forwarded', () => {
        const out = buildProxySpawn({
            baseEnv: {}, reentryArgv: [],
            extraEnv: {
                MEDDLE_HOME: '/tmp/.meddle/sess', PORT: '9042',
                MEDDLE_SESSION_ID: 'my-debug', MEDDLE_HEADLESS: '1', MEDDLE_MCP: '1',
            },
        })
        expect(out.args).toEqual([])
        expect(out.options.env).toMatchObject({
            MEDDLE_ENTRY: 'proxy', MEDDLE_HOME: '/tmp/.meddle/sess', PORT: '9042',
            MEDDLE_SESSION_ID: 'my-debug', MEDDLE_HEADLESS: '1', MEDDLE_MCP: '1',
        })
    })

    it('models supervise: MEDDLE_SUPERVISED=1 + proxyArgs appended after reentry', () => {
        const out = buildProxySpawn({
            baseEnv: {}, reentryArgv: [],
            extraArgv: ['--remote', '--intercept-https'], extraEnv: { MEDDLE_SUPERVISED: '1' },
        })
        expect(out.args).toEqual(['--remote', '--intercept-https'])
        expect(out.options.env).toMatchObject({ MEDDLE_ENTRY: 'proxy', MEDDLE_SUPERVISED: '1' })
    })

    it('defaults stdio to "inherit" so supervised/mcp children stay observable', () => {
        const out = buildProxySpawn({ baseEnv: {}, reentryArgv: [] })
        expect(out.options.stdio).toBe('inherit')
    })

    it('anti-regression: with binary reentry (=[]), user-supplied extraArgv must not smuggle a script-path token', () => {
        const out = buildProxySpawn({
            baseEnv: {}, reentryArgv: [],
            extraArgv: ['--remote', '--remote-token', 'x'],
        })
        for (const a of out.args) {
            // extraArgv are flags/values, never a path to index.js/main.js
            expect(a).not.toMatch(/(^|\/)(index|main)\.js?$/)
        }
        expect(out.options.env.MEDDLE_ENTRY).toBe('proxy')
    })

    it('defaults reentryArgv to [] when omitted (binary context is the safe default)', () => {
        const out = buildProxySpawn({ baseEnv: {} })
        expect(out.args).toEqual([])
        expect(out.options.env.MEDDLE_ENTRY).toBe('proxy')
    })
})

describe('bin/lib/spawn-proxy — env-based CLI self-spawn (daemon: `meddle supervise`)', () => {
    it('sets MEDDLE_ENTRY=cli (NOT proxy)', () => {
        const out = buildCliSpawn({ baseEnv: {}, reentryArgv: [] })
        expect(out.options.env.MEDDLE_ENTRY).toBe('cli')
    })

    it('forwards argv verbatim after reentry (binary: reentryArgv=[])', () => {
        const out = buildCliSpawn({ baseEnv: {}, reentryArgv: [], extraArgv: ['supervise', '--daemon', '--remote'] })
        expect(out.args).toEqual(['supervise', '--daemon', '--remote'])
    })

    it('node form: prepends reentry path before the `supervise` command', () => {
        const mainPath = '/repo/bin/main.js'
        const out = buildCliSpawn({ baseEnv: {}, reentryArgv: [mainPath], extraArgv: ['supervise'] })
        expect(out.args).toEqual([mainPath, 'supervise'])
    })

    it('is env-isolated: baseEnv={} + reentryArgv=[] yields env containing only MEDDLE_ENTRY', () => {
        const out = buildCliSpawn({ baseEnv: {}, reentryArgv: [] })
        expect(Object.keys(out.options.env)).toEqual(['MEDDLE_ENTRY'])
    })
})

describe('bin/lib/spawn-proxy — getReentryArgv (context-coupled: node vs binary)', () => {
    // Under the vitest process (node), getReentryArgv MUST return an absolute path
    // to bin/main.js — i.e. the child re-enters the dispatcher. This is the npm-path
    // contract; if this regresses, `meddle start` under npm spawns `node` with no
    // script and boots nothing.
    it('under node: returns [<abs path>/bin/main.js] (absolute, points at main.js)', () => {
        const r = getReentryArgv()
        expect(r.length).toBe(1)
        expect(typeof r[0]).toBe('string')
        expect(r[0]).toMatch(/[\\/]main\.js?$/)
    })

    it('under node: the returned path is absolute', () => {
        const r = getReentryArgv()
        expect(r.length).toBe(1)
        expect(typeof r[0]).toBe('string')
        if (typeof r[0] === 'string') { expect(isAbsolute(r[0])).toBe(true) }
    })

    it('under node: the returned path resolves to the actual bin/main.js file (basename main.js)', () => {
        const r = getReentryArgv()
        if (typeof r[0] === 'string') { expect(basename(r[0] as string)).toMatch(/^main\.js?$/) }
    })

    it('binary form: when the process IS the meddle binary, getReentryArgv returns [] (execPath dispatches)', () => {
        // Simulate the binary by overriding the context-sensitive reentry decision.
        __setReentryOverrideForTest([])
        expect(getReentryArgv()).toEqual([])
    })
})
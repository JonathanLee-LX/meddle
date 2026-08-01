import { describe, expect, it } from 'vitest'
// SUT lives in bin/lib (plain JS, mirrors existing bin/lib/*.js). Not type-checked by
// tsc (tests excluded, bin not in include). Importing a not-yet-created module is the
// intended Red: vitest will fail with "Cannot find module .../dispatch" — failing for
// the right reason (missing implementation), not a typo.
import { dispatch } from '../bin/lib/dispatch'

describe('bin/lib/dispatch — single-entry env dispatch (M1)', () => {
    // Pure function: dispatch({ env, argv }) -> { entry, argv }
    // env: Record<string, string | undefined> (caller passes a FIXED copy, never process.env
    //      directly — keeps the test deterministic, per tdd skill "don't depend on process.env").
    // argv: string[] — already-stripped-of-node-and-script-path user args, i.e. process.argv.slice(2).
    // Returns the entry to load and the argv to forward.

    it('routes explicit MEDDLE_ENTRY=proxy to the proxy entry', () => {
        const out = dispatch({ env: { MEDDLE_ENTRY: 'proxy' }, argv: [] })
        expect(out.entry).toBe('proxy')
        expect(out.argv).toEqual([])
    })

    it('routes explicit MEDDLE_ENTRY=mcp to the mcp entry', () => {
        const out = dispatch({ env: { MEDDLE_ENTRY: 'mcp' }, argv: [] })
        expect(out.entry).toBe('mcp')
        expect(out.argv).toEqual([])
    })

    it('routes explicit MEDDLE_ENTRY=cli to the cli entry', () => {
        const out = dispatch({ env: { MEDDLE_ENTRY: 'cli' }, argv: [] })
        expect(out.entry).toBe('cli')
        expect(out.argv).toEqual([])
    })

    it('defaults to cli when MEDDLE_ENTRY is absent and argv is empty (bare `meddle`)', () => {
        const out = dispatch({ env: {}, argv: [] })
        expect(out.entry).toBe('cli')
        expect(out.argv).toEqual([])
    })

    it('defaults to cli and forwards argv when MEDDLE_ENTRY is absent (e.g. `meddle start --open`)', () => {
        const out = dispatch({ env: {}, argv: ['start', '--open'] })
        expect(out.entry).toBe('cli')
        expect(out.argv).toEqual(['start', '--open'])
    })

    it('keeps cli routing for the `doctor` subcommand (a real bin/index.js route)', () => {
        const out = dispatch({ env: {}, argv: ['doctor'] })
        expect(out.entry).toBe('cli')
        expect(out.argv).toEqual(['doctor'])
    })

    it('keeps cli routing for `--version` flag', () => {
        const out = dispatch({ env: {}, argv: ['--version'] })
        expect(out.entry).toBe('cli')
        expect(out.argv).toEqual(['--version'])
    })

    it('throws on an unknown MEDDLE_ENTRY value and mentions the allowed set (fail fast)', () => {
        expect(() => dispatch({ env: { MEDDLE_ENTRY: 'bogus' }, argv: [] }))
            .toThrow(/proxy|mcp|cli/)
    })

    it('matches MEDDLE_ENTRY case-insensitively (binary self-spawn sources env from varied callers)', () => {
        expect(dispatch({ env: { MEDDLE_ENTRY: 'PROXY' }, argv: [] }).entry).toBe('proxy')
        expect(dispatch({ env: { MEDDLE_ENTRY: 'Mcp' }, argv: [] }).entry).toBe('mcp')
        expect(dispatch({ env: { MEDDLE_ENTRY: 'CLI' }, argv: [] }).entry).toBe('cli')
    })

    it('preserves --session <id> verbatim in argv (stripping stays in bin/index.js, not here)', () => {
        // bin/index.js currently strips --session to MEDDLE_SESSION_ID; dispatch must NOT.
        const out = dispatch({ env: {}, argv: ['--session', 'abc', 'route', 'list'] })
        expect(out.argv).toEqual(['--session', 'abc', 'route', 'list'])
    })
})
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
    crashFingerprint,
    recordCrash,
    sanitizeCrashData,
    CRASH_DIR,
} from '../bin/lib/crash-report'

const tmpDirs: string[] = []

afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        fs.rmSync(d, { recursive: true, force: true })
    }
})

function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-report-'))
    tmpDirs.push(dir)
    return dir
}

describe('crashFingerprint', () => {
    it('uses the error code when present', () => {
        const err = new Error('boom') as Error & { code: string }
        err.code = 'ECONNRESET'
        expect(crashFingerprint(err)).toBe('ECONNRESET')
    })

    it('falls back to the normalized stack head for code-less errors', () => {
        const err = new Error('read ECONNRESET')
        expect(crashFingerprint(err)).toMatch(/^Error: read ECONNRESET/)
    })

    it('strips addresses, line numbers and volatile details from the fingerprint', () => {
        const err = new Error('boom')
        err.stack = [
            'Error: boom',
            '    at ClientRequest.<anonymous> (file:///var/folders/gw/xxx/T/deno-compile-meddle/dist/core/h2-pool.js:182:30)',
            '    at TCPWrap.onStreamRead (ext:deno_node/net.ts:1:21858)',
            '    at listOnTimeout (node:internal/timers.mjs:4:1174)',
        ].join('\n')
        const fp = crashFingerprint(err)
        // line/column numbers must be normalized
        expect(fp).not.toMatch(/:182:30/)
        expect(fp).not.toMatch(/net\.ts:1:21858/)
        // volatile paths normalized
        expect(fp).not.toMatch(/var\/folders/)
        expect(fp).not.toMatch(/deno-compile-meddle/)
    })

    it('produces a stable fingerprint across repeated identical crashes', () => {
        const make = () => {
            const err = new Error('boom')
            err.stack = [
                'Error: boom',
                '    at f (file:///x/dist/core/a.js:10:20)',
                '    at g (file:///x/dist/core/b.js:3:1)',
            ].join('\n')
            return err
        }
        expect(crashFingerprint(make())).toBe(crashFingerprint(make()))
    })
})

describe('sanitizeCrashData', () => {
    it('never includes env values — only key names', () => {
        const data = sanitizeCrashData({
            envKeys: ['PATH', 'HOME', 'MEDDLE_TOKEN'],
            requestUrl: 'https://365.kdocs.cn/api?token=secret-value&appId=AK123',
            headers: { authorization: 'Bearer abc', cookie: 'session=xyz', 'x-custom': 'ok' },
        })
        expect(JSON.stringify(data)).not.toContain('secret-value')
        expect(JSON.stringify(data)).not.toContain('Bearer abc')
        expect(JSON.stringify(data)).not.toContain('session=xyz')
        expect(JSON.stringify(data)).not.toContain('AK123')
        // benign values survive
        expect(JSON.stringify(data)).toContain('x-custom')
    })

    it('records only env key names, not their values', () => {
        const data = sanitizeCrashData({ envKeys: ['PATH', 'HOME', 'NPM_TOKEN'] })
        expect(data.envKeys).toEqual(['PATH', 'HOME', 'NPM_TOKEN'])
        expect('env' in data).toBe(false)
    })
})

describe('recordCrash', () => {
    it('writes a JSON crash file under <home>/crash with fingerprint and metadata', () => {
        const home = makeTmpDir()
        const err = new Error('boom') as Error & { code: string }
        err.code = 'ECONNRESET'
        err.stack = 'Error: boom\n    at f (file:///x/dist/a.js:10:20)'

        const file = recordCrash({
            home,
            error: err,
            version: '0.4.1',
            platform: 'darwin-arm64',
            envKeys: ['PATH'],
            now: 1_000_000_000,
        })

        expect(path.dirname(file)).toBe(path.join(home, CRASH_DIR))
        expect(fs.existsSync(file)).toBe(true)
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        expect(data.fingerprint).toBe('ECONNRESET')
        expect(data.version).toBe('0.4.1')
        expect(data.platform).toBe('darwin-arm64')
        expect(data.timestamp).toBe(1_000_000_000)
        expect(data.envKeys).toEqual(['PATH'])
        expect(data.error.message).toBe('boom')
    })

    it('dedupes: repeated identical crashes keep at most MAX files per fingerprint', () => {
        const home = makeTmpDir()
        const err = new Error('boom') as Error & { code: string }
        err.code = 'SAME'
        err.stack = 'Error: boom\n    at f (file:///x/dist/a.js:10:20)'

        for (let i = 0; i < 15; i++) {
            recordCrash({ home, error: err, version: '0.4.1', now: 1_000_000_000 + i })
        }

        const files = fs.readdirSync(path.join(home, CRASH_DIR)).filter(f => f.startsWith('SAME-'))
        expect(files.length).toBeLessThanOrEqual(10)
    })

    it('survives write failures without throwing (crash reporter must never crash)', () => {
        const home = makeTmpDir()
        // Make the crash dir a file so mkdir/write fails.
        fs.writeFileSync(path.join(home, CRASH_DIR), 'not a dir')
        const err = new Error('boom')
        expect(() =>
            recordCrash({ home, error: err, version: '0.4.1', now: 1_000_000_000 }),
        ).not.toThrow()
    })
})

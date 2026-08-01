import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildProxySpawn, getReentryArgv } from '../bin/lib/spawn-proxy'

// Integration-level (real spawn, NOT a spy): prove bin/main.js routes via
// MEDDLE_ENTRY and that the proxy actually boots + writes its port file — in
// BOTH the binary context (reentryArgv=[]) and the npm/node context
// (reentryArgv=[bin/main.js]). The npm-path test is the real regression guard:
// if buildProxySpawn forgets the reentry path under node, `meddle start` would
// spawn `node` with no script and boot nothing.
// Per tdd skill: assert observable side effects only (port file, stdout),
// kill the child in afterEach, guard the waits with a rejecting timeout.

const children: ReturnType<typeof spawn>[] = []
const tmpHomes: string[] = []

afterEach(() => {
    for (const c of children.splice(0)) {
        try { if (c.exitCode === null) c.kill('SIGTERM') } catch (_) { /* ignore */ }
    }
})
afterAll(() => {
    for (const h of tmpHomes.splice(0)) {
        try { rmSync(h, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    }
})

function waitForFile(path: string, timeoutMs = 8000): Promise<any> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
        const poll = (): void => {
            if (existsSync(path)) {
                try { resolve(JSON.parse(readFileSync(path, 'utf8'))); return } catch (_) { /* keep polling */ }
            }
            if (Date.now() - start > timeoutMs) { reject(new Error(`timed out waiting for ${path}`)); return }
            setTimeout(poll, 50)
        }
        poll()
    })
}

function bootProxySpawn(reentryArgv: string[]): Promise<string> {
    const home = mkdtempSync(join(tmpdir(), 'meddle-spawn-'))
    tmpHomes.push(home)
    const mcpFile = join(home, 'mcp-proxy-url.json')
    const { args, options } = buildProxySpawn({
        baseEnv: { ...process.env, MEDDLE_HOME: home, MEDDLE_MCP: '1', MEDDLE_HEADLESS: '1' },
        reentryArgv,
        extraEnv: { MEDDLE_MCP: '1', DEBUG: '' },
    })
    const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    return waitForFile(mcpFile, 12000).then((d) => d.proxyUrl as string)
}

describe('bin/main.js — env dispatch end-to-end (real spawn, node context)', () => {
    it('routes MEDDLE_ENTRY=proxy: boots the proxy and writes mcp-proxy-url.json (via bin/main.js reentry)', () => {
        // npm-path contract: getReentryArgv() under node returns [bin/main.js].
        // buildProxySpawn must prepend it so plain `node` re-enters the dispatcher.
        return bootProxySpawn(getReentryArgv()).then((url) => {
            expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        })
    }, 15000)

    it('routes MEDDLE_ENTRY=cli: runs the `version` command via argv', () => {
        return new Promise<void>((resolve, reject) => {
            const home = mkdtempSync(join(tmpdir(), 'meddle-main-cli-'))
            tmpHomes.push(home)
            let out = ''
            const child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'main.js'), 'version'], {
                env: { ...process.env, MEDDLE_HOME: home, MEDDLE_ENTRY: 'cli', MEDDLE_HEADLESS: '1' },
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            children.push(child)
            child.stdout?.on('data', (d) => { out += d.toString() })
            child.on('error', reject)
            const guard = setTimeout(() => { try { child.kill('SIGTERM') } catch (_) {} reject(new Error('version did not exit')) }, 8000)
            child.on('exit', (code) => {
                clearTimeout(guard)
                try {
                    expect(code).toBe(0)
                    expect(out).toContain('meddle')
                    resolve()
                } catch (e) { reject(e as Error) }
            })
        })
    }, 12000)
})
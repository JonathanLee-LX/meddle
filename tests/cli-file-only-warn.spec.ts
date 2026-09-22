import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Issue #85: when proxy probe fails, mock/route mutate commands must warn —
 * must not look like full silent success.
 */

const children: ReturnType<typeof spawn>[] = []
const homes: string[] = []

afterEach(() => {
  for (const c of children.splice(0)) {
    try { if (c.exitCode === null) c.kill('SIGTERM') } catch (_) {}
  }
  for (const h of homes.splice(0)) {
    try { rmSync(h, { recursive: true, force: true }) } catch (_) {}
  }
})

function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'index.js'), ...args], {
      env: {
        ...process.env,
        MEDDLE_HOME: home,
        MEDDLE_HEADLESS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', reject)
    const guard = setTimeout(() => {
      try { child.kill('SIGTERM') } catch (_) {}
      reject(new Error('cli timed out'))
    }, 12000)
    child.on('exit', (code) => {
      clearTimeout(guard)
      resolve({ code, stdout, stderr })
    })
  })
}

const WARN_SNIP = 'could not connect to a running proxy'

describe('CLI file-only downgrade warning (issue #85)', () => {
  it('mock update warns when proxy is unreachable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-warn-'))
    homes.push(home)
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:1',
    }))
    writeFileSync(join(home, 'mocks.json'), JSON.stringify({
      lastId: 1,
      rules: [{
        id: 1, name: 'demo', urlPattern: 'example\\.com/x', method: '*',
        enabled: true, statusCode: 200, delay: 0, bodyType: 'inline',
        headers: {}, body: '{"v":1}', query: '',
      }],
    }, null, 2))

    const { code, stdout, stderr } = await runCli(
      ['mock', 'update', '1', '--body', '{"v":2}'],
      home,
    )
    expect(code).toBe(0)
    expect(stderr + stdout).toContain(WARN_SNIP)
    expect(stdout).toMatch(/Mock Rule Updated/i)
  }, 15000)

  it('route update warns when proxy is unreachable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-warn-route-'))
    homes.push(home)
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:1',
    }))
    const rulesDir = join(home, 'route-rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'default.txt'), 'example.com 127.0.0.1:3000\n')
    writeFileSync(join(home, 'settings.json'), JSON.stringify({
      activeRuleFiles: ['default'],
    }))

    const { code, stdout, stderr } = await runCli(
      ['route', 'update', 'default', 'example.com', '127.0.0.1:4000'],
      home,
    )
    expect(code).toBe(0)
    expect(stderr + stdout).toContain(WARN_SNIP)
    expect(stdout).toMatch(/Route Rule Updated/i)
  }, 15000)

  it('mock update --json includes fileOnly + warning fields', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-warn-json-'))
    homes.push(home)
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:1',
    }))
    writeFileSync(join(home, 'mocks.json'), JSON.stringify({
      lastId: 1,
      rules: [{
        id: 1, name: 'demo', urlPattern: 'example\\.com/x', method: '*',
        enabled: true, statusCode: 200, delay: 0, bodyType: 'inline',
        headers: {}, body: '{"v":1}', query: '',
      }],
    }, null, 2))

    const { code, stdout, stderr } = await runCli(
      ['mock', 'update', '1', '--body', '{"v":3}', '--json'],
      home,
    )
    expect(code).toBe(0)
    expect(stderr).toContain(WARN_SNIP)
    const line = stdout.trim().split('\n').filter(Boolean).pop()!
    const parsed = JSON.parse(line)
    expect(parsed.fileOnly).toBe(true)
    expect(String(parsed.warning || '')).toContain(WARN_SNIP)
  }, 15000)
})

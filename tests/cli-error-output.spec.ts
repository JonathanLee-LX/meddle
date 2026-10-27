import { describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Issue #153: command failures go to stderr and exit non-zero.
 * `meddle --help` and `route add --help` document `--exclusions=`.
 * `--json` errors stay a single JSON object on stdout.
 */

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const home = mkdtempSync(join(tmpdir(), 'meddle-cli-err-'))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'index.js'), ...args], {
      env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      rmSync(home, { recursive: true, force: true })
      reject(err)
    })
    const guard = setTimeout(() => {
      try { child.kill('SIGTERM') } catch (_) {}
      reject(new Error(`cli timed out: ${args.join(' ')}`))
    }, 12000)
    child.on('exit', (code) => {
      clearTimeout(guard)
      rmSync(home, { recursive: true, force: true })
      resolve({ code, stdout, stderr })
    })
  })
}

describe('CLI error output (#153)', () => {
  it('writes a human-mode route error to stderr and exits non-zero', async () => {
    const { code, stdout, stderr } = await runCli(['route', 'update', 't', 'foo.com !/a', '--exclusions='])
    expect(code).not.toBe(0)
    expect(stderr).toContain('Pass exclusions either as')
    expect(stderr).toContain('✗')
    expect(stdout).not.toContain('Pass exclusions either as')
    expect(stdout.trim()).toBe('')
  })

  it('writes other command failures to stderr as well', async () => {
    const missing = await runCli(['mock', 'delete'])
    expect(missing.code).not.toBe(0)
    expect(missing.stderr).toContain('Missing required argument: <id>')
    expect(missing.stdout.trim()).toBe('')

    const unknown = await runCli(['not-a-command'])
    expect(unknown.code).not.toBe(0)
    expect(unknown.stderr).toContain('Unknown command: not-a-command')
    expect(unknown.stdout).not.toContain('Unknown command')
  })

  it('keeps --json errors as JSON on stdout', async () => {
    const { code, stdout, stderr } = await runCli(['route', 'update', 't', 'foo.com !/a', '--exclusions=', '--json'])
    expect(code).not.toBe(0)
    const body = JSON.parse(stdout)
    expect(body).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('Pass exclusions either as') },
    })
    expect(stdout).not.toContain('✗')
    expect(stderr).not.toContain('✗')
  })

  it('documents route add --exclusions= in meddle --help and route add --help', async () => {
    const top = await runCli(['--help'])
    expect(top.code).toBe(0)
    expect(top.stderr.trim()).toBe('')
    const addUsage = top.stdout.split('\n').find((line) => line.includes('route add <file>'))
    expect(addUsage).toContain('--exclusions=')
    expect(top.stdout).toContain('meddle route add dev-rules "api.test.com" "localhost:3000" --exclusions=')

    const add = await runCli(['route', 'add', '--help'])
    expect(add.code).toBe(0)
    expect(add.stdout).toMatch(/route add[^\n]*--exclusions=/)
    expect(add.stdout).toContain('--exclusions= clears')
  })
})

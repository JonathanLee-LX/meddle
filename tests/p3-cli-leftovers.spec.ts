import { describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveConfiguredMocksPath } from '../bin/lib/meddle-home'
import { NEW_RULE_COMMENT_MESSAGE } from '../core/rule-file-edit'

/**
 * Issue #157 leftovers: --json failures, unknown-command help on stderr,
 * mock add --help, doctor mocksFilePath vs MEDDLE_HOME, status on a corrupt
 * mocks.json, empty rule file not reported as missing.
 */

function runCli(
  args: string[],
  opts: { home?: string; cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; home: string }> {
  const home = opts.home || mkdtempSync(join(tmpdir(), 'meddle-p3-cli-'))
  const createdHome = !opts.home
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'bin', 'index.js'), ...args], {
      cwd: opts.cwd || home,
      env: { ...process.env, MEDDLE_HOME: home, MEDDLE_HEADLESS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      if (createdHome) rmSync(home, { recursive: true, force: true })
      reject(err)
    })
    const guard = setTimeout(() => {
      try { child.kill('SIGTERM') } catch (_) { /* ignore */ }
      reject(new Error(`cli timed out: ${args.join(' ')}`))
    }, 12000)
    child.on('exit', (code) => {
      clearTimeout(guard)
      if (createdHome) rmSync(home, { recursive: true, force: true })
      resolve({ code, stdout, stderr, home })
    })
  })
}

describe('CLI P3 leftovers (#157)', () => {
  it('prints {success:false} on stdout for --json command errors', async () => {
    const show = await runCli(['route', 'show', 'no-such-file', '--json'])
    expect(show.code).not.toBe(0)
    expect(JSON.parse(show.stdout)).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('Route file not found') },
    })
    expect(show.stdout).not.toContain('✗')
    expect(show.stderr).toContain('Route file not found')
    expect(show.stderr).not.toContain('✗')

    const missing = await runCli(['mock', 'delete', '--json'])
    expect(missing.code).not.toBe(0)
    expect(JSON.parse(missing.stdout)).toMatchObject({
      success: false,
      error: { message: 'Missing required argument: <id>' },
    })

    const add = await runCli(['mock', 'add', '--json'])
    expect(add.code).not.toBe(0)
    expect(JSON.parse(add.stdout)).toMatchObject({
      success: false,
      error: { message: 'Missing required option: --name' },
    })
  })

  it('writes unknown subcommand help to stderr, not stdout', async () => {
    const mock = await runCli(['mock', 'bogus-sub'])
    expect(mock.code).not.toBe(0)
    expect(mock.stderr).toContain('Unknown command: mock bogus-sub')
    expect(mock.stderr).toContain('meddle mock list')
    expect(mock.stdout.trim()).toBe('')

    const route = await runCli(['route', 'bogus-sub'])
    expect(route.code).not.toBe(0)
    expect(route.stderr).toContain('Unknown command: route bogus-sub')
    expect(route.stderr).toContain('meddle route list')
    expect(route.stdout.trim()).toBe('')
  })

  it('prints mock add --help instead of treating --help as a missing --name', async () => {
    const { code, stdout, stderr } = await runCli(['mock', 'add', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('meddle mock add --name')
    expect(stdout).toContain('--pattern')
    expect(stderr.trim()).toBe('')
    expect(stdout).not.toContain('Missing required option')
  })

  it('resolves doctor mocksFilePath against MEDDLE_HOME, not cwd', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-p3-doctor-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'meddle-p3-doctor-cwd-'))
    try {
      mkdirSync(join(home, 'custom'), { recursive: true })
      writeFileSync(join(home, 'custom', 'mocks.json'), JSON.stringify({ rules: [] }))
      writeFileSync(join(home, 'settings.json'), JSON.stringify({ mocksFilePath: 'custom/mocks.json' }))
      const { code, stdout } = await runCli(['doctor'], { home, cwd })
      expect(code).toBe(0)
      expect(stdout).toContain(join(home, 'custom', 'mocks.json'))
      expect(stdout).toContain('Mock 规则数量: 0 条')
      expect(stdout).not.toContain('Mock 规则文件不存在')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('keeps status running when mocks.json is corrupt', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-p3-status-'))
    try {
      writeFileSync(join(home, 'mocks.json'), '{not json')
      const human = await runCli(['status'], { home })
      expect(human.code).toBe(0)
      expect(human.stdout).toContain('Proxy Status')
      expect(human.stdout).toContain('Mock 规则文件格式错误')
      expect(human.stdout).not.toContain('已禁止写入以免覆盖')

      const json = await runCli(['status', '--json'], { home })
      expect(json.code).toBe(0)
      const body = JSON.parse(json.stdout)
      expect(body.running).toBe(false)
      expect(body.mocks.error).toBe('Mock 规则文件格式错误')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not report an empty route file as missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'meddle-p3-empty-rule-'))
    try {
      const created = await runCli(['route', 'create', 'empty-file'], { home })
      expect(created.code).toBe(0)
      const addSlash = await runCli(['route', 'add', 'empty-file', '//x', 'localhost:80'], { home })
      expect(addSlash.code).not.toBe(0)
      expect(addSlash.stderr).not.toContain('Route file not found')
      expect(addSlash.stderr).toContain(NEW_RULE_COMMENT_MESSAGE)

      const addOk = await runCli(['route', 'add', 'empty-file', 'example.com', 'localhost:80'], { home })
      expect(addOk.code).toBe(0)
      expect(addOk.stderr).not.toContain('Route file not found')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('resolveConfiguredMocksPath (CLI copy)', () => {
  it('expands ~ and resolves relative paths against MEDDLE_HOME', () => {
    expect(resolveConfiguredMocksPath('rel/mocks.json', '/tmp/meddle-home')).toBe(join('/tmp/meddle-home', 'rel/mocks.json'))
    expect(resolveConfiguredMocksPath('~/x.json', '/tmp/meddle-home', '/Users/me')).toBe(join('/Users/me', 'x.json'))
  })
})

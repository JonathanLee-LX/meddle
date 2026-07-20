#!/usr/bin/env node

const { spawn } = require('child_process')

const host = '127.0.0.1'
const port = parseInt(process.env.MEDDLE_DRILL_PORT || '18989', 10)
const baseUrl = `http://${host}:${port}`
const serverBootTimeoutMs = parseInt(process.env.MEDDLE_DRILL_BOOT_TIMEOUT_MS || '20000', 10)
const pollIntervalMs = 250

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(path, init) {
  const res = await fetch(baseUrl + path, init)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (_) {
    throw new Error(`${path} non-json response: ${text.slice(0, 100)}`)
  }
  if (!res.ok) {
    throw new Error(`${path} status=${res.status}`)
  }
  return data
}

function waitForExit(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
  })
}

function createServerProcess(stageEnv) {
  const child = spawn(process.execPath, ['index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      ...stageEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  return child
}

async function waitForReady(child) {
  const start = Date.now()
  while (Date.now() - start < serverBootTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before ready (code=${child.exitCode})`)
    }
    try {
      await fetchJson('/api/pipeline/config')
      return
    } catch (_) {
      await sleep(pollIntervalMs)
    }
  }
  throw new Error(`server not ready within ${serverBootTimeoutMs}ms`)
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([waitForExit(child), sleep(5000)])
  if (child.exitCode !== null) return
  child.kill('SIGKILL')
  await Promise.race([waitForExit(child), sleep(2000)])
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function runStage(name, stageEnv, verifier) {
  const child = createServerProcess(stageEnv)
  try {
    await waitForReady(child)
    await verifier()
    console.log(`[OK] ${name}`)
  } finally {
    await stopServer(child)
  }
}

async function verifyCommon(mode) {
  const config = await fetchJson('/api/pipeline/config')
  assert(config.mode === mode, `expected mode=${mode}, got ${config.mode}`)

  const status = await fetchJson('/api/refactor/status')
  assert(status.mode === mode, `status mode mismatch: ${status.mode}`)

  const plugins = await fetchJson('/api/plugins')
  assert(typeof plugins.total === 'number', 'plugins.total should be number')

  const health = await fetchJson('/api/plugins/health')
  assert(typeof health.total === 'number', 'health.total should be number')
  assert(typeof health.overall === 'string', 'health.overall should be string')
}

async function main() {
  // Stage 1: shadow observation mode check
  await runStage(
    'stage-shadow',
    {
      MEDDLE_PLUGIN_MODE: 'shadow',
      MEDDLE_ENABLE_BUILTIN_MOCK: '1',
    },
    async () => {
      await verifyCommon('shadow')
      const readiness = await fetchJson('/api/pipeline/readiness')
      assert(readiness.mode === 'shadow', 'readiness mode should be shadow')
      await fetchJson('/api/pipeline/shadow-stats', { method: 'POST' })
    }
  )

  // Stage 2: on mode with host allowlist
  await runStage(
    'stage-on-allowlist',
    {
      MEDDLE_PLUGIN_MODE: 'on',
      MEDDLE_PLUGIN_ON_HOSTS: 'solution.wps.cn,api.wps.cn',
      MEDDLE_ENABLE_BUILTIN_MOCK: '1',
    },
    async () => {
      await verifyCommon('on')
      const config = await fetchJson('/api/pipeline/config')
      assert(Array.isArray(config.allowlist), 'allowlist should be array')
      assert(config.allowlist.includes('solution.wps.cn'), 'allowlist missing solution.wps.cn')
      assert(config.allowlist.includes('api.wps.cn'), 'allowlist missing api.wps.cn')
    }
  )

  // Stage 3: rollback to off mode
  await runStage(
    'stage-rollback-off',
    {
      MEDDLE_PLUGIN_MODE: 'off',
    },
    async () => {
      await verifyCommon('off')
      const config = await fetchJson('/api/pipeline/config')
      assert(config.mode === 'off', 'rollback failed, mode is not off')
    }
  )

  console.log('[DONE] rollout drill finished')
}

main().catch((err) => {
  console.error('[FAIL] rollout drill:', err && err.message ? err.message : err)
  process.exit(1)
})


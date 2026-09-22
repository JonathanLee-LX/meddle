import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createMockHandler, dedupeMockRulesById } from '../core/mock-handler'

/**
 * Issue #85: mocks file watcher hot-reloads when the file is edited externally.
 */

function makeCtx(overrides: any = {}) {
    const tmpDir = overrides.meddleDir || os.tmpdir()
    return {
        meddleDir: tmpDir, certDir: tmpDir, settingsPath: path.join(tmpDir, 'settings-test-mh.json'),
        AUTO_OPEN: false, REFACTOR_CONFIG: {}, INITIAL_PLUGIN_MODE: 'off' as const,
        MAX_RECORD_SIZE: 100, MAX_DETAIL_SIZE: 50, MAX_BODY_SIZE: 1024 * 1024,
        MAX_DETAIL_BODY_SIZE: 1024 * 1024,
        resolveDetailBodySizeBytes: () => 1024 * 1024,
        SHADOW_WARN_MIN_SAMPLES: 10, SHADOW_WARN_DIFF_RATE: 0.5,
        PLUGIN_ON_HOSTS: new Set<string>(), ENABLE_BUILTIN_ROUTER_PLUGIN: false,
        ENABLE_BUILTIN_LOGGER_PLUGIN: false, ENABLE_BUILTIN_MOCK_PLUGIN: false,
        pluginManager: {}, hookDispatcher: {}, requestPipeline: { mode: 'off' },
        builtinLoggerPlugin: {}, shadowCompareTracker: {}, onModeGate: {}, pipelineGate: {},
        ruleMap: {}, currentMocksPath: null as string | null, mockRules: [] as any[], mockIdSeq: 1,
        proxyRecordArr: [] as any[], recordIdSeq: 0,
        proxyRecordDetailMap: new Map(), httpsServerMap: new Map(),
        localWSServer: null,
        ...overrides,
    }
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve()
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

describe('mock file watcher (issue #85)', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-mw-'))
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reloads rules when mocks.json is edited on disk', async () => {
    const ctx = makeCtx({ meddleDir: tmpDir })
    const mockFile = path.join(tmpDir, 'mocks.json')
    fs.writeFileSync(mockFile, JSON.stringify({
      nextId: 2,
      rules: [{
        id: 1, name: 'before', urlPattern: 'a\\.com', method: '*',
        enabled: true, statusCode: 200, delay: 0, bodyType: 'inline',
        headers: {}, body: 'old', query: '',
      }],
    }, null, 2))

    const handler = createMockHandler(ctx)
    handler.loadMockRules()
    expect(ctx.mockRules[0]?.name).toBe('before')

    let reloads = 0
    handler.initMockFileWatcher(() => { reloads += 1 })

    // Give chokidar a moment to attach before the external write.
    await new Promise((r) => setTimeout(r, 200))

    fs.writeFileSync(mockFile, JSON.stringify({
      nextId: 2,
      rules: [{
        id: 1, name: 'after', urlPattern: 'a\\.com', method: '*',
        enabled: true, statusCode: 200, delay: 0, bodyType: 'inline',
        headers: {}, body: 'new', query: '',
      }],
    }, null, 2))

    await waitFor(() => ctx.mockRules[0]?.name === 'after' && reloads >= 1)
    expect(ctx.mockRules[0].name).toBe('after')
    expect(ctx.mockRules[0].body).toBe('new')
    expect(reloads).toBeGreaterThanOrEqual(1)
  }, 10000)

  it('dedupeMockRulesById still works (sanity)', () => {
    const rules = [
      { id: 1, name: 'a' },
      { id: 1, name: 'b' },
      { id: 2, name: 'c' },
    ] as any
    const out = dedupeMockRulesById(rules)
    expect(out).toHaveLength(2)
    expect(out.find(r => r.id === 1)?.name).toBe('b')
  })
})

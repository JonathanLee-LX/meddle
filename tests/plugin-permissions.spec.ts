import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validatePermissions,
  logPermissionWarnings,
  shouldAllowPlugin,
  wrapPluginWithPermissionChecks,
  getSecurityWarning,
  PermissionCheckResult,
} from '../core/plugin-permissions'
import { Plugin, PluginManifest } from '../core/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    hooks: [],
    permissions: [],
    ...overrides,
  }
}

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    manifest: makeManifest(overrides.manifest),
    setup: async () => {},
    ...overrides,
  }
}

function makeLogger() {
  const calls: { level: string; args: any[] }[] = []
  return {
    info(msg: string, ...args: any[]) { calls.push({ level: 'info', args: [msg, ...args] }) },
    warn(msg: string, ...args: any[]) { calls.push({ level: 'warn', args: [msg, ...args] }) },
    error(msg: string, ...args: any[]) { calls.push({ level: 'error', args: [msg, ...args] }) },
    calls,
  }
}

// ---------------------------------------------------------------------------
// validatePermissions
// ---------------------------------------------------------------------------

describe('validatePermissions', () => {
  it('returns valid with no warnings for empty permissions', () => {
    const result = validatePermissions(makeManifest({ permissions: [] }))
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.dangerousPermissions).toHaveLength(0)
    expect(result.unknownPermissions).toHaveLength(0)
  })

  it('returns valid with no warnings for safe-only permissions', () => {
    const result = validatePermissions(makeManifest({
      permissions: ['proxy:read', 'config:read', 'storage:read'],
    }))
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.dangerousPermissions).toHaveLength(0)
  })

  it('flags dangerous permissions in the result', () => {
    const result = validatePermissions(makeManifest({
      permissions: ['proxy:write', 'response:shortcircuit'],
    }))
    expect(result.valid).toBe(true)
    expect(result.dangerousPermissions).toEqual(['proxy:write', 'response:shortcircuit'])
  })

  it('warns when modifying hooks are declared without any permissions', () => {
    const result = validatePermissions(makeManifest({
      permissions: [],
      hooks: ['onBeforeProxy'],
    }))
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('修改请求的 hooks')
  })

  it('does not warn when hooks are declared with permissions', () => {
    const result = validatePermissions(makeManifest({
      permissions: ['proxy:read'],
      hooks: ['onBeforeProxy'],
    }))
    // No warning about missing permissions since permissions are declared
    const missingPermWarning = result.warnings.filter(w => w.includes('修改请求的 hooks'))
    expect(missingPermWarning).toHaveLength(0)
  })

  it('flags unknown permissions as warnings', () => {
    const result = validatePermissions(makeManifest({
      permissions: ['completely:unknown'],
    }))
    expect(result.unknownPermissions).toEqual(['completely:unknown'])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('未知的权限')
  })

  it('accepts all valid permissions without unknown warnings', () => {
    const result = validatePermissions(makeManifest({
      permissions: [
        'proxy:read', 'config:read', 'storage:read',
        'network:outbound', 'storage:write', 'config:write',
        'proxy:write', 'response:shortcircuit',
      ],
    }))
    expect(result.unknownPermissions).toHaveLength(0)
    expect(result.dangerousPermissions).toContain('network:outbound')
    expect(result.dangerousPermissions).toContain('proxy:write')
    expect(result.dangerousPermissions).toContain('response:shortcircuit')
  })
})

// ---------------------------------------------------------------------------
// logPermissionWarnings
// ---------------------------------------------------------------------------

describe('logPermissionWarnings', () => {
  it('logs warnings for each warning in the result', () => {
    const logger = makeLogger()
    const result: PermissionCheckResult = {
      valid: true,
      warnings: ['warning-1', 'warning-2'],
      errors: [],
      dangerousPermissions: [],
      unknownPermissions: [],
    }

    logPermissionWarnings(result, logger, 'test.plugin')

    const warnCalls = logger.calls.filter(c => c.level === 'warn')
    expect(warnCalls).toHaveLength(2)
    expect(warnCalls[0].args[0]).toContain('[test.plugin]')
    expect(warnCalls[0].args[0]).toContain('warning-1')
    expect(warnCalls[1].args[0]).toContain('warning-2')
  })

  it('logs additional warnings for dangerous permissions', () => {
    const logger = makeLogger()
    const result: PermissionCheckResult = {
      valid: true,
      warnings: [],
      errors: [],
      dangerousPermissions: ['proxy:write'],
      unknownPermissions: [],
    }

    logPermissionWarnings(result, logger, 'danger.plugin')

    const warnCalls = logger.calls.filter(c => c.level === 'warn')
    // Two warnings: one listing dangerous perms, one about safety implications
    expect(warnCalls.length).toBeGreaterThanOrEqual(2)
    expect(warnCalls[0].args[0]).toContain('危险权限')
  })

  it('logs errors for each error in the result', () => {
    const logger = makeLogger()
    const result: PermissionCheckResult = {
      valid: false,
      warnings: [],
      errors: ['error-1'],
      dangerousPermissions: [],
      unknownPermissions: [],
    }

    logPermissionWarnings(result, logger, 'err.plugin')

    const errorCalls = logger.calls.filter(c => c.level === 'error')
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0].args[0]).toContain('[err.plugin]')
    expect(errorCalls[0].args[0]).toContain('error-1')
  })
})

// ---------------------------------------------------------------------------
// shouldAllowPlugin
// ---------------------------------------------------------------------------

describe('shouldAllowPlugin', () => {
  const ENV_KEY = 'EP_BLOCK_DANGEROUS_PLUGINS'
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY]
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[ENV_KEY] = originalEnv
    } else {
      delete process.env[ENV_KEY]
    }
  })

  it('allows plugin by default (no env var)', () => {
    const result: PermissionCheckResult = {
      valid: true, warnings: [], errors: [],
      dangerousPermissions: ['proxy:write'],
      unknownPermissions: [],
    }
    expect(shouldAllowPlugin(result)).toBe(true)
  })

  it('blocks dangerous plugins when EP_BLOCK_DANGEROUS_PLUGINS is true', () => {
    process.env[ENV_KEY] = 'true'
    const result: PermissionCheckResult = {
      valid: true, warnings: [], errors: [],
      dangerousPermissions: ['proxy:write'],
      unknownPermissions: [],
    }
    expect(shouldAllowPlugin(result)).toBe(false)
  })

  it('allows plugin when env is set but there are no dangerous permissions', () => {
    process.env[ENV_KEY] = 'true'
    const result: PermissionCheckResult = {
      valid: true, warnings: [], errors: [],
      dangerousPermissions: [],
      unknownPermissions: [],
    }
    expect(shouldAllowPlugin(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// wrapPluginWithPermissionChecks
// ---------------------------------------------------------------------------

describe('wrapPluginWithPermissionChecks', () => {
  it('proxies calls to the original hook', async () => {
    let hookCalled = false
    const plugin = makePlugin({
      manifest: makeManifest({ id: 'proxy.test', hooks: ['onBeforeProxy'] }),
      onBeforeProxy: async (_ctx: any) => { hookCalled = true },
    })

    const logger = makeLogger()
    const wrapped = wrapPluginWithPermissionChecks(plugin, logger)

    await wrapped.onBeforeProxy!({ target: 'http://example.com' } as any)
    expect(hookCalled).toBe(true)
  })

  it('logs hook execution via info', async () => {
    const plugin = makePlugin({
      manifest: makeManifest({ id: 'log.test', hooks: ['onRequestStart'] }),
      onRequestStart: async () => {},
    })

    const logger = makeLogger()
    const wrapped = wrapPluginWithPermissionChecks(plugin, logger)

    await wrapped.onRequestStart!({} as any)

    const infoCalls = logger.calls.filter(c => c.level === 'info')
    expect(infoCalls.length).toBeGreaterThanOrEqual(1)
    expect(infoCalls[0].args[0]).toContain('[log.test]')
    expect(infoCalls[0].args[0]).toContain('onRequestStart')
  })

  it('detects target modification without proxy:write permission', async () => {
    const plugin = makePlugin({
      manifest: makeManifest({
        id: 'target.mod',
        hooks: ['onBeforeProxy'],
        permissions: [],
      }),
      onBeforeProxy: async (ctx: any) => {
        ctx.target = 'https://modified.com'
      },
    })

    const logger = makeLogger()
    const wrapped = wrapPluginWithPermissionChecks(plugin, logger)

    const context = {
      target: 'https://modified.com',
      _originalTarget: 'https://original.com',
    }
    await wrapped.onBeforeProxy!(context)

    const warnCalls = logger.calls.filter(c => c.level === 'warn')
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
    expect(warnCalls[0].args[0]).toContain('[target.mod]')
    expect(warnCalls[0].args[0]).toContain('proxy:write')
  })

  it('detects shortCircuit without response:shortcircuit permission', async () => {
    const plugin = makePlugin({
      manifest: makeManifest({
        id: 'short.test',
        hooks: ['onRequestStart'],
        permissions: [],
      }),
      onRequestStart: async (ctx: any) => {
        ctx.shortCircuited = true
      },
    })

    const logger = makeLogger()
    const wrapped = wrapPluginWithPermissionChecks(plugin, logger)

    const context = {
      target: 'http://original.com',
      _originalTarget: 'http://original.com',
      shortCircuited: true,
    }
    await wrapped.onRequestStart!(context)

    const warnCalls = logger.calls.filter(c => c.level === 'warn')
    const shortCircuitWarnings = warnCalls.filter(c => c.args[0].includes('shortcircuit'))
    expect(shortCircuitWarnings.length).toBeGreaterThanOrEqual(1)
  })

  it('allows modifications when proper permissions are declared', async () => {
    const plugin = makePlugin({
      manifest: makeManifest({
        id: 'allowed.mod',
        hooks: ['onBeforeProxy'],
        permissions: ['proxy:write'],
      }),
      onBeforeProxy: async (ctx: any) => {
        ctx.target = 'https://allowed-mod.com'
      },
    })

    const logger = makeLogger()
    const wrapped = wrapPluginWithPermissionChecks(plugin, logger)

    const context = {
      target: 'https://allowed-mod.com',
      _originalTarget: 'https://original.com',
    }
    await wrapped.onBeforeProxy!(context)

    const warnCalls = logger.calls.filter(c => c.level === 'warn')
    const permWarnings = warnCalls.filter(c => c.args[0].includes('proxy:write'))
    expect(permWarnings).toHaveLength(0)
  })

  it('copies non-hook methods (start, stop, dispose)', () => {
    const plugin = makePlugin({
      manifest: makeManifest({ id: 'lifecycle.test' }),
      start: async () => {},
      stop: async () => {},
      dispose: () => {},
    })

    const wrapped = wrapPluginWithPermissionChecks(plugin)
    expect(typeof wrapped.start).toBe('function')
    expect(typeof wrapped.stop).toBe('function')
    expect(typeof wrapped.dispose).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// getSecurityWarning
// ---------------------------------------------------------------------------

describe('getSecurityWarning', () => {
  it('returns a formatted string with the plugin name', () => {
    const warning = getSecurityWarning(makeManifest({
      id: 'my.plugin',
      hooks: ['onBeforeProxy'],
      permissions: [],
    }))
    expect(warning).toContain('my.plugin')
    expect(warning).toContain('onBeforeProxy')
  })

  it('highlights dangerous permissions when present', () => {
    const warning = getSecurityWarning(makeManifest({
      id: 'danger.plugin',
      permissions: ['proxy:write', 'network:outbound'],
    }))
    expect(warning).toContain('proxy:write')
    expect(warning).toContain('network:outbound')
    expect(warning).toContain('危险权限')
  })

  it('does not highlight dangerous section when no dangerous perms', () => {
    const warning = getSecurityWarning(makeManifest({
      id: 'safe.plugin',
      permissions: ['proxy:read'],
    }))
    expect(warning).not.toContain('危险权限')
  })
})

import { describe, expect, it } from 'vitest'
import type { Plugin } from '@/types'
import { customPluginFilename, groupPlugins, isCustomPlugin } from './plugin-groups'

function plugin(overrides: Partial<Plugin> & { id: string }): Plugin {
  return {
    name: overrides.id,
    version: '1.0.0',
    hooks: [],
    permissions: [],
    priority: 100,
    state: 'running',
    stats: null,
    ...overrides,
  }
}

const file = (filename: string, pluginId?: string) => ({ filename, modified: 0, ...(pluginId ? { pluginId } : {}) })

describe('groupPlugins (#112)', () => {
  it('places a custom plugin with a non-local id only in the custom group, using backend source/filename', () => {
    const plugins = [
      plugin({ id: 'builtin.router', source: 'builtin' }),
      plugin({ id: 'add-trace-header', source: 'custom', filename: 'add-trace-header.js' }),
    ]
    const { builtinPlugins, customRows } = groupPlugins(plugins, [file('add-trace-header.js')])
    expect(builtinPlugins.map((p) => p.id)).toEqual(['builtin.router'])
    expect(customRows).toHaveLength(1)
    expect(customRows[0].loadedPlugin?.id).toBe('add-trace-header')
    expect(customRows[0].pluginId).toBe('add-trace-header')
  })

  it('matches by the pluginId reported in the custom file listing', () => {
    const plugins = [plugin({ id: 'trace.header' })]
    const { builtinPlugins, customRows } = groupPlugins(plugins, [file('add-trace-header.js', 'trace.header')])
    expect(builtinPlugins).toEqual([])
    expect(customRows[0].loadedPlugin?.id).toBe('trace.header')
  })

  it('never lists the same plugin in both groups', () => {
    const plugins = [
      plugin({ id: 'builtin.mock', source: 'builtin' }),
      plugin({ id: 'local.a', source: 'custom', filename: 'a.js' }),
      plugin({ id: 'b-plugin', source: 'custom', filename: 'b.js' }),
      plugin({ id: 'local.legacy' }),
    ]
    const { builtinPlugins, customRows } = groupPlugins(plugins, [file('a.js'), file('b.js'), file('legacy.js'), file('ghost.js')])
    const builtinIds = new Set(builtinPlugins.map((p) => p.id))
    const customIds = customRows.flatMap((row) => (row.loadedPlugin ? [row.loadedPlugin.id] : []))
    expect(customIds.filter((id) => builtinIds.has(id))).toEqual([])
    expect([...builtinIds]).toEqual(['builtin.mock'])
    expect(customRows.find((row) => row.file.filename === 'ghost.js')?.loadedPlugin).toBeUndefined()
  })

  it('a built-in never gets claimed by a custom file through the local.<name> convention', () => {
    const plugins = [plugin({ id: 'local.x', source: 'builtin' })]
    const { builtinPlugins, customRows } = groupPlugins(plugins, [file('x.js')])
    expect(builtinPlugins.map((p) => p.id)).toEqual(['local.x'])
    expect(customRows[0].loadedPlugin).toBeUndefined()
  })

  it('falls back to the local.<file> convention for older backends without source', () => {
    const plugins = [plugin({ id: 'builtin.logger' }), plugin({ id: 'local.demo' })]
    const { builtinPlugins, customRows } = groupPlugins(plugins, [file('demo.js')])
    expect(builtinPlugins.map((p) => p.id)).toEqual(['builtin.logger'])
    expect(customRows[0].loadedPlugin?.id).toBe('local.demo')
  })

  it('excludes third-party plugin ids from the built-in group', () => {
    const { builtinPlugins } = groupPlugins([plugin({ id: 'tp.one' })], [], new Set(['tp.one']))
    expect(builtinPlugins).toEqual([])
  })
})

describe('custom plugin helpers', () => {
  it('prefers backend source/filename over the id convention', () => {
    expect(isCustomPlugin({ id: 'add-trace-header', source: 'custom' })).toBe(true)
    expect(isCustomPlugin({ id: 'local.x', source: 'builtin' })).toBe(false)
    expect(isCustomPlugin({ id: 'local.x' })).toBe(true)
    expect(customPluginFilename({ id: 'add-trace-header', filename: 'add-trace-header.js' })).toBe('add-trace-header.js')
    expect(customPluginFilename({ id: 'local.demo' })).toBe('demo.js')
    expect(customPluginFilename({ id: 'builtin.mock' })).toBe('')
  })
})

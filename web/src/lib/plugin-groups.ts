import type { Plugin } from '@/types'

export interface CustomPluginFile {
  filename: string
  modified: string | number | Date
  /** Manifest id the backend loaded from this file, if loaded */
  pluginId?: string
}

export interface CustomPluginRow {
  file: CustomPluginFile
  /** Effective plugin id (loaded id, or the `local.<name>` convention as a fallback) */
  pluginId: string
  loadedPlugin?: Plugin
}

export function conventionalCustomPluginId(filename: string) {
  return `local.${filename.replace(/\.js$/, '')}`
}

/**
 * Split the backend plugin list into the built-in group and the custom file
 * rows. Each loaded plugin lands in exactly one group:
 *  - a plugin matched to a custom file (by backend filename, the file's
 *    loaded pluginId, or the `local.<name>` convention) is custom;
 *  - otherwise backend `source` decides; older backends without `source`
 *    fall back to the `local.` id prefix heuristic;
 *  - third-party plugin ids are excluded from the built-in group.
 */
export function groupPlugins(
  plugins: Plugin[],
  customFiles: CustomPluginFile[],
  thirdPartyIds: Set<string> = new Set(),
): { builtinPlugins: Plugin[]; customRows: CustomPluginRow[] } {
  const claimed = new Set<string>()

  const customRows = customFiles.map((file) => {
    const loadedPlugin =
      plugins.find((plugin) => plugin.filename === file.filename) ??
      (file.pluginId ? plugins.find((plugin) => plugin.id === file.pluginId) : undefined) ??
      plugins.find(
        (plugin) =>
          plugin.id === conventionalCustomPluginId(file.filename) &&
          plugin.source !== 'builtin' &&
          (!plugin.filename || plugin.filename === file.filename),
      )
    if (loadedPlugin) claimed.add(loadedPlugin.id)
    return {
      file,
      pluginId: loadedPlugin?.id ?? file.pluginId ?? conventionalCustomPluginId(file.filename),
      loadedPlugin,
    }
  })

  const builtinPlugins = plugins.filter((plugin) => {
    if (claimed.has(plugin.id) || thirdPartyIds.has(plugin.id)) return false
    if (plugin.source) return plugin.source === 'builtin'
    return !plugin.id.startsWith('local.')
  })

  return { builtinPlugins, customRows }
}

/** Whether a loaded plugin comes from a custom plugin file. */
export function isCustomPlugin(plugin: Pick<Plugin, 'id' | 'source'>) {
  if (plugin.source) return plugin.source === 'custom'
  return plugin.id.startsWith('local.')
}

/** File name of a loaded custom plugin (backend-reported, or by `local.<name>` convention). */
export function customPluginFilename(plugin: Pick<Plugin, 'id' | 'filename'>) {
  if (plugin.filename) return plugin.filename
  return plugin.id.startsWith('local.') ? `${plugin.id.slice('local.'.length)}.js` : ''
}

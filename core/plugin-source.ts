/**
 * Tracks where a registered plugin came from, so the plugin list API can
 * report built-in vs custom without relying on manifest id conventions
 * (custom plugin authors are free to pick ids that do not start with `local.`).
 */

export type PluginSourceKind = 'builtin' | 'custom'

export interface PluginSource {
    kind: PluginSourceKind
    /** File name inside ~/.meddle/plugins for custom plugins */
    filename?: string
}

const sources = new WeakMap<object, PluginSource>()

export function markPluginSource(plugin: object, source: PluginSource): void {
    if (plugin && typeof plugin === 'object') sources.set(plugin, source)
}

export function getPluginSource(plugin: object): PluginSource | undefined {
    if (!plugin || typeof plugin !== 'object') return undefined
    return sources.get(plugin)
}

/**
 * Drop custom plugins whose manifest id collides with a reserved (built-in)
 * id or with an earlier custom plugin. Built-in plugins always win; among
 * custom files the first one (directory order) wins.
 */
export function filterCustomPluginConflicts<T extends { manifest: { id: string } }>(
    customPlugins: T[],
    reservedIds: Iterable<string>,
    warn: (message: string) => void = () => {},
): T[] {
    const reserved = new Set(reservedIds)
    const seen = new Set<string>()
    const accepted: T[] = []
    for (const plugin of customPlugins) {
        const id = plugin && plugin.manifest && plugin.manifest.id
        const filename = getPluginSource(plugin)?.filename
        const label = filename ? `${id} (${filename})` : String(id)
        if (reserved.has(id)) {
            warn(`跳过自定义插件 ${label}: 与内置插件 id 冲突`)
            continue
        }
        if (seen.has(id)) {
            warn(`跳过自定义插件 ${label}: 与其他自定义插件 id 重复`)
            continue
        }
        seen.add(id)
        accepted.push(plugin)
    }
    return accepted
}

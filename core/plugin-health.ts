import { 
    PluginHealth, 
    PluginHealthInput, 
    PluginHealthItem, 
    PluginHealthCounts,
    PluginManifest,
    PluginState
} from './types';

export function buildPluginHealth(input: PluginHealthInput = {}): PluginHealth {
    const pluginStats = input.pluginStats || {};
    const pluginStates = input.pluginStates || {};
    const manifests = Array.isArray(input.plugins) ? input.plugins : [];

    const plugins: PluginHealthItem[] = manifests.map((manifest: PluginManifest) => {
        const id = manifest.id;
        const state = pluginStates[id] || 'unknown';
        const stats = pluginStats[id] || null;
        const total = stats && typeof stats.total === 'number' ? stats.total : 0;
        const error = stats && typeof stats.error === 'number' ? stats.error : 0;
        const timeout = stats && typeof stats.timeout === 'number' ? stats.timeout : 0;
        const failed = error + timeout;
        const errorRate = total > 0 ? failed / total : 0;

        let health: 'healthy' | 'degraded' | 'disabled' | 'inactive' = 'inactive';
        if (state === 'disabled') {
            health = 'disabled';
        } else if (failed > 0) {
            health = 'degraded';
        } else if (state === 'running') {
            health = 'healthy';
        }

        return {
            id,
            name: manifest.name,
            version: manifest.version,
            state: state as PluginState,
            health,
            errorRate,
            stats,
        };
    });

    const counts: PluginHealthCounts = {
        healthy: 0,
        degraded: 0,
        disabled: 0,
        inactive: 0,
    };
    for (const item of plugins) {
        counts[item.health] += 1;
    }

    const overall: 'healthy' | 'degraded' = counts.disabled > 0 || counts.degraded > 0 ? 'degraded' : 'healthy';
    return {
        overall,
        total: plugins.length,
        counts,
        plugins,
    };
}

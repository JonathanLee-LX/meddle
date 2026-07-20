import { BootstrapPluginsOptions } from './types';
import { createPluginContextFactory } from './plugin-context-factory';

export async function bootstrapPlugins(options: BootstrapPluginsOptions): Promise<void> {
    const pluginManager = options.pluginManager;
    const plugins = Array.isArray(options.plugins) ? options.plugins : [];
    const contextFactory = options.contextFactory || createPluginContextFactory();

    for (const plugin of plugins) {
        pluginManager.register(plugin);
    }
    await pluginManager.setup(contextFactory);
    await pluginManager.start();
}

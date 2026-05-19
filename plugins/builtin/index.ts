import { Plugin, BuiltinPluginsOptions } from '../../core/types';

export function createBuiltinPlugins(options: BuiltinPluginsOptions): Plugin[] {
    const plugins: Plugin[] = [];
    
    if (options.enableMock) {
        plugins.push(options.createMockPlugin({
            findMatch: options.findMockMatch!,
        }));
    }
    
    if (options.enableRouter) {
        plugins.push(options.createRouterPlugin({
            getRuleMap: options.getRuleMap!,
            getExcludeMap: options.getExcludeMap,
            getRouteRules: options.getRouteRules,
        }));
    }
    
    if (options.enableLogger && options.loggerPlugin) {
        plugins.push(options.loggerPlugin);
    }
    
    return plugins;
}

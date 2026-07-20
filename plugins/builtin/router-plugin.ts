import { Plugin, RouterPluginOptions, HookContext } from '../../core/types';
import { findMatchedRouteRule } from '../../helpers';

export function createBuiltinRouterPlugin(options: RouterPluginOptions): Plugin {
    const getRouteRules = options.getRouteRules;

    return {
        manifest: {
            id: 'builtin.router',
            name: 'Builtin Router Plugin',
            version: '1.0.0',
            apiVersion: '1.x',
            type: 'builtin',
            permissions: ['proxy:read', 'proxy:write'],
            hooks: ['onBeforeProxy'],
            priority: 30,
        },
        async setup() {},
        onBeforeProxy(ctx: HookContext): void {
            const sourceUrl = ctx.request && ctx.request.url;
            if (!sourceUrl) return;

            const routeRules = getRouteRules?.();
            if (!routeRules?.length) return;

            const matched = findMatchedRouteRule(sourceUrl, routeRules);
            if (matched) {
                ctx.setTarget(matched.resolvedUrl);
                ctx.meta.routerMatched = true;
                ctx.meta.matchedRule = matched.entry.pattern;
                ctx.meta.matchedTarget = matched.resolvedUrl;
            }
        },
    };
}

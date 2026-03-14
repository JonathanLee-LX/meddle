import { Plugin, RouterPluginOptions, HookContext } from '../../core/types';

export function createBuiltinRouterPlugin(options: RouterPluginOptions): Plugin {
    const getRuleMap = options.getRuleMap;
    
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

            const ruleMap = getRuleMap();
            // Import resolveTargetUrl dynamically to avoid circular dependency
            const { resolveTargetUrl } = require('../../helpers');
            const mapped = resolveTargetUrl(sourceUrl, ruleMap);
            if (mapped) {
                ctx.setTarget(mapped);
                ctx.meta.routerMatched = true;
                // 记录匹配的路由规则
                const matchedPattern = Object.keys(ruleMap).find(pattern => new RegExp(pattern).test(sourceUrl));
                if (matchedPattern) {
                    ctx.meta.matchedRule = matchedPattern;
                    ctx.meta.matchedTarget = mapped;
                }
            }
        },
    };
}

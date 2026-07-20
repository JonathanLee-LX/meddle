import { Plugin, MockPluginOptions, HookContext } from '../../core/types';

/**
 * 检测响应体的 Content-Type
 */
function detectContentType(body: string): string {
    if (!body || typeof body !== 'string') {
        return 'text/plain; charset=utf-8';
    }

    const trimmed = body.trim();
    
    // 检测 JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'application/json; charset=utf-8';
        } catch {
            // 继续检测其他类型
        }
    }
    
    // 检测 HTML
    if (trimmed.startsWith('<!DOCTYPE') || 
        trimmed.startsWith('<html') ||
        /<[a-z][\s\S]*>/i.test(trimmed)) {
        return 'text/html; charset=utf-8';
    }
    
    // 检测 XML
    if (trimmed.startsWith('<?xml')) {
        return 'application/xml; charset=utf-8';
    }
    
    // 检测 CSS
    if (/[a-z-]+\s*\{[\s\S]*\}/i.test(trimmed) || 
        /@(media|keyframes|import|font-face)/i.test(trimmed)) {
        return 'text/css; charset=utf-8';
    }
    
    // 检测 JavaScript
    if (/(function|const|let|var|class|import|export|=>)/i.test(trimmed)) {
        return 'application/javascript; charset=utf-8';
    }
    
    // 默认为纯文本
    return 'text/plain; charset=utf-8';
}

export function createBuiltinMockPlugin(options: MockPluginOptions): Plugin {
    const findMatch = options.findMatch;
    
    return {
        manifest: {
            id: 'builtin.mock',
            name: 'Builtin Mock Plugin',
            version: '1.0.0',
            apiVersion: '1.x',
            type: 'builtin',
            permissions: ['proxy:read', 'response:shortcircuit'],
            hooks: ['onBeforeProxy'],
            priority: 20,
        },
        async setup() {},
        async onBeforeProxy(ctx: HookContext): Promise<void> {
            if (!ctx || !ctx.request) return;
            
            const rule = findMatch(ctx.request.url || '', ctx.request.method);
            if (!rule) return;
            if (rule.bodyType && rule.bodyType !== 'inline') return;

            const delay = Number(rule.delay || 0);
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            ctx.meta.mockRuleId = rule.id;
            ctx.meta.mockRuleName = rule.name || '';
            
            // 检测或使用自定义的 Content-Type
            const ruleHeaders = rule.headers || {};
            const hasContentType = Object.keys(ruleHeaders).some(
                key => key.toLowerCase() === 'content-type'
            );
            const contentType = hasContentType 
                ? undefined  // 保留 rule.headers 中的 Content-Type
                : detectContentType(rule.body || '');
            
            const responseHeaders: Record<string, string> = {
                'X-Mock-Rule': encodeURIComponent(rule.name || String(rule.id || '')),
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Headers': '*',
            };
            
            // 如果没有自定义 Content-Type，则使用检测到的类型
            if (contentType) {
                responseHeaders['Content-Type'] = contentType;
            }
            
            // 合并自定义响应头（会覆盖默认的 Content-Type）
            Object.assign(responseHeaders, ruleHeaders);
            
            ctx.respond({
                statusCode: rule.statusCode || 200,
                headers: responseHeaders,
                body: rule.body || '',
            });
        },
    };
}

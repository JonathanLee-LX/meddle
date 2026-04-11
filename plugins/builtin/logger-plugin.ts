import { Plugin, LoggerPluginOptions, HookContext, ResponseContext, ErrorContext, LoggerEntry, LoggerSummary } from '../../core/types';

type StatusBucket = '2xx' | '3xx' | '4xx' | '5xx' | 'other';

interface LoggerPlugin extends Plugin {
    getRecentEntries(): LoggerEntry[];
    getSummary(): LoggerSummary;
}

export function createBuiltinLoggerPlugin(options: LoggerPluginOptions = {}): LoggerPlugin {
    const maxEntries = typeof options.maxEntries === 'number' ? options.maxEntries : 1000;
    const entries: LoggerEntry[] = [];
    const counters = {
        totalResponses: 0,
        totalErrors: 0,
        byMethod: Object.create(null) as Record<string, number>,
        byStatusBucket: {
            '2xx': 0,
            '3xx': 0,
            '4xx': 0,
            '5xx': 0,
            other: 0,
        },
        duration: {
            min: null as number | null,
            max: null as number | null,
            sum: 0,
        },
    };

    return {
        manifest: {
            id: 'builtin.logger',
            name: 'Builtin Logger Plugin',
            version: '1.0.0',
            apiVersion: '1.x',
            type: 'builtin',
            permissions: ['proxy:read', 'storage:write'],
            hooks: ['onRequestStart', 'onAfterResponse', 'onError'],
            priority: 90,
        },
        async setup() {},
        onRequestStart(ctx: HookContext): void {
            ctx.meta._pluginRequestStartAt = Date.now();
        },
        onAfterResponse(ctx: ResponseContext): void {
            const startAt = (ctx.meta._pluginRequestStartAt as number) || Date.now();
            const duration = Date.now() - startAt;
            const statusCode = ctx.response.statusCode;
            const method = String(ctx.request.method || 'UNKNOWN').toUpperCase();

            // 获取路由匹配信息
            const matchedRule = ctx.meta.matchedRule;
            const matchedTarget = ctx.meta.matchedTarget;
            const mockRuleId = ctx.meta.mockRuleId;
            const mockRuleName = ctx.meta.mockRuleName;
            const routerMatched = ctx.meta.routerMatched;

            // 判断命中类型
            let hitType: 'route' | 'mock' | 'direct' = 'direct';
            if (mockRuleId) {
                hitType = 'mock';
            } else if (routerMatched) {
                hitType = 'route';
            }

            entries.push({
                type: 'response',
                method,
                url: ctx.request.url,
                statusCode,
                duration,
                ts: Date.now(),
                matchedRule,
                matchedTarget,
                mockRuleId,
                mockRuleName,
                hitType,
            });
            
            counters.totalResponses += 1;
            counters.byMethod[method] = (counters.byMethod[method] || 0) + 1;
            const bucket = statusToBucket(statusCode);
            counters.byStatusBucket[bucket] += 1;
            counters.duration.sum += duration;
            counters.duration.min = counters.duration.min == null ? duration : Math.min(counters.duration.min, duration);
            counters.duration.max = counters.duration.max == null ? duration : Math.max(counters.duration.max, duration);
            
            if (entries.length > maxEntries) entries.shift();
        },
        onError(ctx: ErrorContext): void {
            entries.push({
                type: 'error',
                phase: ctx.phase,
                message: ctx.error ? ctx.error.message : 'unknown',
                ts: Date.now(),
            });
            counters.totalErrors += 1;
            if (entries.length > maxEntries) entries.shift();
        },
        getRecentEntries(): LoggerEntry[] {
            return entries.slice();
        },
        getSummary(): LoggerSummary {
            return {
                totalResponses: counters.totalResponses,
                totalErrors: counters.totalErrors,
                byMethod: { ...counters.byMethod },
                byStatusBucket: { ...counters.byStatusBucket },
                avgDuration: counters.totalResponses > 0
                    ? Number((counters.duration.sum / counters.totalResponses).toFixed(2))
                    : 0,
                minDuration: counters.duration.min,
                maxDuration: counters.duration.max,
            };
        },
    };
}

function statusToBucket(statusCode: number): StatusBucket {
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return '3xx';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500 && statusCode < 600) return '5xx';
    return 'other';
}

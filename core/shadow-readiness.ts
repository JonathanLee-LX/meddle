import { 
    ReadinessResult, 
    ReadinessOptions, 
    ReadinessAdvice, 
    ReadinessAdviceInput,
    ShadowCompareStats 
} from './types';

export function evaluateShadowReadiness(
    stats: ShadowCompareStats | null, 
    options: ReadinessOptions = {}
): ReadinessResult {
    const minSamples = typeof options.minSamples === 'number' ? options.minSamples : 200;
    const maxDiffRate = typeof options.maxDiffRate === 'number' ? options.maxDiffRate : 0.05;
    const total = Number(stats && stats.total ? stats.total : 0);
    const diffRate = Number(stats && typeof stats.diffRate === 'number' ? stats.diffRate : 0);

    if (total < minSamples) {
        return {
            ready: false,
            reason: 'insufficient_samples',
            total,
            minSamples,
            diffRate,
            maxDiffRate,
        };
    }
    if (diffRate > maxDiffRate) {
        return {
            ready: false,
            reason: 'diff_rate_too_high',
            total,
            minSamples,
            diffRate,
            maxDiffRate,
        };
    }
    return {
        ready: true,
        reason: 'ok',
        total,
        minSamples,
        diffRate,
        maxDiffRate,
    };
}

export function buildReadinessAdvice(input: ReadinessAdviceInput = {}): ReadinessAdvice {
    const mode = input.mode || 'off';
    const readiness = input.readiness || { ready: false, reason: 'unknown', total: 0, minSamples: 0, diffRate: 0, maxDiffRate: 0 };
    const allowlist = Array.isArray(input.allowlist) ? input.allowlist : [];
    const onModeGate = input.onModeGate || {};

    if (mode === 'off') {
        return {
            level: 'info',
            suggestedMode: 'shadow',
            message: '当前为 off，建议先切到 shadow 收集对照数据。',
            nextSteps: [
                '设置 MEDDLE_PLUGIN_MODE=shadow',
                '观察 /api/pipeline/shadow-stats 与 /api/pipeline/readiness',
            ],
        };
    }

    if (mode === 'shadow' && !readiness.ready) {
        if (readiness.reason === 'insufficient_samples') {
            return {
                level: 'info',
                suggestedMode: 'shadow',
                message: '样本量不足，继续保持 shadow 收集更多流量。',
                nextSteps: [
                    `至少采集 ${readiness.minSamples} 条样本`,
                    '检查 topDiffs 是否集中在少数规则',
                ],
            };
        }
        if (readiness.reason === 'diff_rate_too_high') {
            return {
                level: 'warn',
                suggestedMode: 'shadow',
                message: '差异率偏高，不建议切到 on。',
                nextSteps: [
                    '优先修复 topDiffs 中高频差异对',
                    '确认规则解析和 mock 路径在插件侧行为一致',
                ],
            };
        }
    }

    if (mode === 'shadow' && readiness.ready) {
        return {
            level: 'success',
            suggestedMode: 'on',
            message: allowlist.length > 0
                ? '满足切换条件，建议先对白名单 host 切 on。'
                : '满足切换条件，建议先设置少量 host 白名单再切 on。',
            nextSteps: allowlist.length > 0
                ? [
                    '设置 MEDDLE_PLUGIN_MODE=on',
                    '保持白名单小范围观测并监控错误率',
                ]
                : [
                    '先设置 MEDDLE_PLUGIN_ON_HOSTS（1-3 个核心 host）',
                    '然后设置 MEDDLE_PLUGIN_MODE=on',
                ],
        };
    }

    if (mode === 'on') {
        const applied = Number(onModeGate.applied || 0);
        const skipped = Number(onModeGate.skippedByAllowlist || 0);
        return {
            level: 'info',
            suggestedMode: 'on',
            message: '当前已在 on 模式，建议持续观察插件健康与差异趋势。',
            nextSteps: [
                `当前 on 生效请求数: ${applied}`,
                `当前因白名单跳过请求数: ${skipped}`,
                '监控 /api/plugins 与 /api/pipeline/readiness',
            ],
        };
    }

    return {
        level: 'info',
        suggestedMode: mode,
        message: '无可用建议。',
        nextSteps: [],
    };
}

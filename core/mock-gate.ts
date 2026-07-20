import { MockGateOptions } from './types';

export function shouldUsePluginMock(options: MockGateOptions): boolean {
    const enabled = !!options.enabled;
    const mode = options.mode || 'off';
    const source = options.source || '';
    const rule = options.rule || null;
    const shouldApplyOn = options.shouldApplyOn || (() => false);

    if (!enabled) return false;
    if (mode !== 'on') return false;
    if (!shouldApplyOn(source)) return false;
    if (rule && rule.bodyType && rule.bodyType !== 'inline') return false;
    return true;
}

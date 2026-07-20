import { shouldUsePluginMock } from './mock-gate';
import { PipelineGate, PipelineGateOptions } from './types';

export function createPipelineGate(options: PipelineGateOptions): PipelineGate {
    const requestPipeline = options.requestPipeline;
    const onModeGate = options.onModeGate;
    const enableBuiltinMockPlugin = !!options.enableBuiltinMockPlugin;

    function shouldApplyPipelineOnForSource(source: string): boolean {
        return onModeGate.shouldApply(source);
    }

    function canUsePipelineExecuteForSource(source: string): boolean {
        if (requestPipeline.mode === 'off') return false;
        if (requestPipeline.mode === 'shadow') return true;
        return shouldApplyPipelineOnForSource(source);
    }

    function shouldUsePluginMockForRequest(source: string, rule: any): boolean {
        return shouldUsePluginMock({
            enabled: enableBuiltinMockPlugin,
            mode: requestPipeline.mode,
            source,
            rule,
            shouldApplyOn: shouldApplyPipelineOnForSource,
        });
    }

    return {
        shouldApplyPipelineOnForSource,
        canUsePipelineExecuteForSource,
        shouldUsePluginMockForRequest,
    };
}

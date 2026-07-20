import { RouteDecisionOptions, RouteDecisionResult } from './types';

export async function decideRoute(options: RouteDecisionOptions): Promise<RouteDecisionResult> {
    const {
        source,
        method,
        headers,
        reqBody,
        legacyTarget,
        requestPipeline,
        canUsePipelineExecuteForSource,
        observeShadowDecision,
        fallbackResolve,
    } = options;

    if (canUsePipelineExecuteForSource(source)) {
        const decision = await requestPipeline.evaluateRequest(
            { method, url: source, headers, body: reqBody },
            requestPipeline.mode === 'on' ? source : legacyTarget
        );
        if (requestPipeline.mode === 'shadow' && typeof observeShadowDecision === 'function') {
            observeShadowDecision(method, source, decision.target, decision.observedTarget);
        }
        return {
            target: decision.target,
            shortCircuited: !!decision.shortCircuited,
            response: decision.response || null,
            meta: decision.meta,
        };
    }

    return fallbackResolve();
}

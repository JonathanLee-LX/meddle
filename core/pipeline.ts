import {
    Pipeline,
    PipelineOptions,
    PipelineDecision,
    PipelineResult,
    PipelineExecuteInput,
    HookContext,
    ResponseContext,
    Request,
    Response,
    PluginMode,
    InspectionStage,
} from './types';
import { dispatchWithInspection } from './inspection-dispatch';

const SUPPORTED_MODES = new Set<string>(['off', 'shadow', 'on']);

export function createPipeline(options: PipelineOptions): Pipeline {
    const pluginManager = options.pluginManager;
    const dispatcher = options.dispatcher;
    const logger = options.logger || console;
    let mode = normalizeMode(options.mode);

    return {
        get mode() { return mode; },
        setMode(newMode: PluginMode) { mode = normalizeMode(newMode); },
        async evaluateRequest(request: Request, initialTarget: string): Promise<PipelineDecision> {
            const hookContext = createHookContext(request || {}, initialTarget);
            if (mode === 'off') {
                return {
                    target: initialTarget,
                    observedTarget: initialTarget,
                    shortCircuited: false,
                    response: null,
                    meta: hookContext.meta,
                };
            }
            await dispatchWithInspection(dispatcher, logger, 'onRequestStart', hookContext);
            await dispatchWithInspection(dispatcher, logger, 'onBeforeProxy', hookContext);
            if (mode === 'shadow') {
                return {
                    target: initialTarget,
                    observedTarget: hookContext.target,
                    shortCircuited: false,
                    response: null,
                    meta: hookContext.meta,
                };
            }
            if (hookContext.shortCircuited) {
                return {
                    target: hookContext.target,
                    observedTarget: hookContext.target,
                    shortCircuited: true,
                    response: hookContext.shortCircuitResponse || {
                        statusCode: 200,
                        headers: {},
                        body: '',
                    },
                    meta: hookContext.meta,
                };
            }
            return {
                target: hookContext.target,
                observedTarget: hookContext.target,
                shortCircuited: false,
                response: null,
                meta: hookContext.meta,
            };
        },
        async execute(input: PipelineExecuteInput): Promise<PipelineResult> {
            const request = input.request || {};
            const initialTarget = input.initialTarget || request.url || '';
            if (mode === 'off') {
                return input.executeUpstream(initialTarget, {});
            }
            const decision = await this.evaluateRequest(request, initialTarget);

            if (decision.shortCircuited) {
                const shortCircuitContext = {
                    request,
                    target: decision.target,
                    meta: decision.meta,
                };
                const responseContext = createResponseContext(
                    shortCircuitContext, 
                    decision.response!
                );
                await dispatchWithInspection(dispatcher, logger, 'onBeforeResponse', responseContext);
                await dispatchWithInspection(dispatcher, logger, 'onAfterResponse', responseContext);
                return {
                    shortCircuited: true,
                    response: responseContext.response,
                    target: decision.target,
                    meta: decision.meta,
                };
            }

            const upstream = await input.executeUpstream(decision.target, decision.meta);
            const responseContext = createResponseContext(
                { request, target: decision.target, meta: decision.meta },
                upstream.response || upstream
            );
            await dispatchWithInspection(dispatcher, logger, 'onBeforeResponse', responseContext);
            await dispatchWithInspection(dispatcher, logger, 'onAfterResponse', responseContext);
            return {
                ...upstream,
                shortCircuited: false,
                target: decision.target,
                response: responseContext.response,
                meta: decision.meta,
            };
        },
        pluginManager,
    };
}

function createHookContext(request: Request, target: string): HookContext {
    const inspectionStages: InspectionStage[] = [];
    return {
        request,
        target,
        meta: {
            _inspectionStages: inspectionStages,
        },
        shortCircuited: false,
        shortCircuitResponse: null,
        log: console,  // 为插件提供日志接口
        setTarget(nextTarget: string): void {
            this.target = nextTarget;
        },
        respond(response: Response): void {
            this.shortCircuited = true;
            this.shortCircuitResponse = response;
        },
    };
}

function createResponseContext(
    requestContext: { request: Request; target: string; meta: Record<string, any> },
    response: Partial<Response>
): ResponseContext {
    return {
        request: requestContext.request,
        target: requestContext.target,
        meta: requestContext.meta,
        log: console,  // 为插件提供日志接口
        response: {
            statusCode: response.statusCode || 200,
            headers: response.headers || {},
            body: response.body || '',
        },
    };
}

export function normalizeMode(mode?: string): PluginMode {
    const normalized = (mode || 'off').toLowerCase();
    return SUPPORTED_MODES.has(normalized) ? (normalized as PluginMode) : 'off';
}

export { SUPPORTED_MODES };

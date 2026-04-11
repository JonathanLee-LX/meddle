import {
    Pipeline,
    PipelineOptions,
    PipelineDecision,
    PipelineResult,
    PipelineExecuteInput,
    HookContext,
    ResponseContext,
    ErrorContext,
    Request,
    Response,
    PluginMode,
    InspectionStage,
    HookName,
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

            try {
                await dispatchWithInspection(dispatcher, logger, 'onRequestStart', hookContext);
            } catch (error: any) {
                await dispatchOnError(dispatcher, logger, request, hookContext.target, hookContext.meta, 'onRequestStart', error);
                throw error;
            }

            try {
                await dispatchWithInspection(dispatcher, logger, 'onBeforeProxy', hookContext);
            } catch (error: any) {
                await dispatchOnError(dispatcher, logger, request, hookContext.target, hookContext.meta, 'onBeforeProxy', error);
                throw error;
            }

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
                try {
                    return input.executeUpstream(initialTarget, {});
                } catch (error: any) {
                    await dispatchOnError(dispatcher, logger, request, initialTarget, {}, 'upstream', error);
                    throw error;
                }
            }

            let decision: PipelineDecision;
            try {
                decision = await this.evaluateRequest(request, initialTarget);
            } catch (error: any) {
                // evaluateRequest already dispatched onError
                throw error;
            }

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

                try {
                    await dispatchWithInspection(dispatcher, logger, 'onBeforeResponse', responseContext);
                } catch (error: any) {
                    await dispatchOnError(dispatcher, logger, request, decision.target, decision.meta, 'onBeforeResponse', error);
                    throw error;
                }

                try {
                    await dispatchWithInspection(dispatcher, logger, 'onAfterResponse', responseContext);
                } catch (error: any) {
                    await dispatchOnError(dispatcher, logger, request, decision.target, decision.meta, 'onAfterResponse', error);
                    throw error;
                }

                return {
                    shortCircuited: true,
                    response: responseContext.response,
                    target: decision.target,
                    meta: decision.meta,
                };
            }

            let upstream: any;
            try {
                upstream = await input.executeUpstream(decision.target, decision.meta);
            } catch (error: any) {
                await dispatchOnError(dispatcher, logger, request, decision.target, decision.meta, 'upstream', error);
                throw error;
            }

            const responseContext = createResponseContext(
                { request, target: decision.target, meta: decision.meta },
                upstream.response || upstream
            );

            try {
                await dispatchWithInspection(dispatcher, logger, 'onBeforeResponse', responseContext);
            } catch (error: any) {
                await dispatchOnError(dispatcher, logger, request, decision.target, decision.meta, 'onBeforeResponse', error);
                throw error;
            }

            try {
                await dispatchWithInspection(dispatcher, logger, 'onAfterResponse', responseContext);
            } catch (error: any) {
                await dispatchOnError(dispatcher, logger, request, decision.target, decision.meta, 'onAfterResponse', error);
                throw error;
            }

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

function createErrorContext(
    request: Request,
    target: string,
    meta: Record<string, any>,
    phase: HookName,
    error: Error
): ErrorContext {
    return {
        request,
        target,
        meta,
        phase,
        error,
        log: console,
    };
}

async function dispatchOnError(
    dispatcher: any,
    logger: any,
    request: Request,
    target: string,
    meta: Record<string, any>,
    phase: HookName,
    error: Error
): Promise<void> {
    const errorContext = createErrorContext(request, target, meta, phase, error);
    try {
        await dispatchWithInspection(dispatcher, logger, 'onError', errorContext);
    } catch (innerError: any) {
        logger.error(`[pipeline] onError dispatch failed:`, innerError.message);
    }
}

export function normalizeMode(mode?: string): PluginMode {
    const normalized = (mode || 'off').toLowerCase();
    return SUPPORTED_MODES.has(normalized) ? (normalized as PluginMode) : 'off';
}

export { SUPPORTED_MODES };

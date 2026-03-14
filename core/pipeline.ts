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
    Logger,
    InspectionStage,
} from './types';

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
            await safeDispatch(dispatcher, logger, 'onRequestStart', hookContext);
            await safeDispatch(dispatcher, logger, 'onBeforeProxy', hookContext);
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
                await safeDispatch(dispatcher, logger, 'onBeforeResponse', responseContext);
                await safeDispatch(dispatcher, logger, 'onAfterResponse', responseContext);
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
            await safeDispatch(dispatcher, logger, 'onBeforeResponse', responseContext);
            await safeDispatch(dispatcher, logger, 'onAfterResponse', responseContext);
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

async function safeDispatch(
    dispatcher: any,
    logger: Logger,
    hookName: string,
    context: HookContext | ResponseContext
): Promise<any[]> {
    const stages = (context as HookContext).meta?._inspectionStages as InspectionStage[] | undefined;
    const prevTarget = (context as HookContext).target;
    const prevShortCircuited = (context as HookContext).shortCircuited;

    try {
        const results = await dispatcher.dispatch(hookName, context);

        // 记录每个插件的执行结果
        if (stages && Array.isArray(results)) {
            for (const result of results) {
                const stage: InspectionStage = {
                    name: result.pluginId || 'unknown',
                    type: result.pluginId?.startsWith('builtin.') ? 'builtin' : 'custom',
                    hook: hookName,
                    status: result.status === 'ok' ? 'ok' : result.status === 'skipped-disabled' ? 'skipped' : 'error',
                    duration: result.duration || 0,
                    target: (context as HookContext).target,
                    error: result.error,
                };

                // 记录 target 变化
                if ((context as HookContext).target !== prevTarget) {
                    stage.changes = {
                        ...stage.changes,
                        target: (context as HookContext).target,
                    };
                }

                // 记录短路状态
                if ((context as HookContext).shortCircuited && !prevShortCircuited) {
                    stage.shortCircuited = true;
                    stage.status = 'short-circuited';
                    // 记录响应变化
                    const shortCircuitResponse = (context as HookContext).shortCircuitResponse;
                    if (shortCircuitResponse) {
                        stage.changes = {
                            ...stage.changes,
                            responseStatusCode: shortCircuitResponse.statusCode,
                            responseHeaders: shortCircuitResponse.headers as Record<string, string>,
                            responseBody: typeof shortCircuitResponse.body === 'string' ? shortCircuitResponse.body : '',
                        };
                    }
                }

                stages.push(stage);
            }
        }

        return results;
    } catch (error: any) {
        logger.error(
            `[pipeline] dispatch ${hookName} failed:`,
            error && error.message ? error.message : error
        );

        // 记录错误阶段
        if (stages) {
            stages.push({
                name: 'pipeline',
                type: 'system',
                hook: hookName,
                status: 'error',
                duration: 0,
                error: error?.message || String(error),
            });
        }

        return [];
    }
}

export function normalizeMode(mode?: string): PluginMode {
    const normalized = (mode || 'off').toLowerCase();
    return SUPPORTED_MODES.has(normalized) ? (normalized as PluginMode) : 'off';
}

export { SUPPORTED_MODES };

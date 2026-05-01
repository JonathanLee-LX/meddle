import { InspectionStage, HookContext, ResponseContext, RequestSentContext, ErrorContext, Logger, IHookDispatcher, HookDispatchResult } from './types'

function hasDifferentHeaders(a: Record<string, string>, b: Record<string, string>): boolean {
    return JSON.stringify(a) !== JSON.stringify(b)
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!headers || typeof headers !== 'object') return out
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue
        out[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    return out
}

function cloneResponse(response: Partial<{ statusCode: number; headers: Record<string, string | string[]>; body: string | Buffer }> | null | undefined) {
    if (!response || typeof response !== 'object') return null
    return {
        statusCode: response.statusCode || 200,
        headers: normalizeHeaders(response.headers),
        body: typeof response.body === 'string' ? response.body : String(response.body || ''),
    }
}

type DispatchContext = HookContext | ResponseContext | RequestSentContext | ErrorContext

export async function dispatchWithInspection(
    dispatcher: IHookDispatcher,
    logger: Logger,
    hookName: string,
    context: DispatchContext,
): Promise<HookDispatchResult[]> {
    const stages = (context as any).meta?._inspectionStages as InspectionStage[] | undefined
    const fallbackBefore = {
        target: (context as HookContext).target,
        shortCircuited: (context as HookContext).shortCircuited,
        requestHeaders: normalizeHeaders((context as any).request?.headers),
        response: cloneResponse((context as any).response),
        shortCircuitResponse: cloneResponse((context as HookContext).shortCircuitResponse),
    }

    try {
        const results = await dispatcher.dispatch(hookName, context)

        if (stages && Array.isArray(results)) {
            const fallbackAfter = {
                target: (context as HookContext).target,
                shortCircuited: (context as HookContext).shortCircuited,
                requestHeaders: normalizeHeaders((context as any).request?.headers),
                response: cloneResponse((context as any).response),
                shortCircuitResponse: cloneResponse((context as HookContext).shortCircuitResponse),
            }

            for (const result of results) {
                const contextBefore = result.contextBefore || fallbackBefore
                const contextAfter = result.contextAfter || fallbackAfter
                const beforeTarget = contextBefore.target
                const afterTarget = contextAfter.target
                const beforeShortCircuited = contextBefore.shortCircuited
                const afterShortCircuited = contextAfter.shortCircuited
                const beforeRequestHeaders = contextBefore.requestHeaders || {}
                const afterRequestHeaders = contextAfter.requestHeaders || {}
                const beforeResponse = contextBefore.response || null
                const afterResponse = contextAfter.response || null

                const stage: InspectionStage = {
                    name: result.pluginId || 'unknown',
                    type: result.pluginId?.startsWith('builtin.') ? 'builtin' : 'custom',
                    hook: hookName,
                    status: result.status === 'ok' ? 'ok' : result.status === 'skipped-disabled' ? 'skipped' : 'error',
                    duration: result.duration || 0,
                    target: afterTarget,
                    error: result.error,
                }

                if (afterTarget !== beforeTarget) {
                    stage.changes = {
                        ...stage.changes,
                        target: afterTarget,
                        targetBefore: beforeTarget,
                        targetAfter: afterTarget,
                    }
                }

                if (hasDifferentHeaders(beforeRequestHeaders, afterRequestHeaders)) {
                    stage.changes = {
                        ...stage.changes,
                        requestHeaders: afterRequestHeaders,
                        requestHeadersBefore: beforeRequestHeaders,
                        requestHeadersAfter: afterRequestHeaders,
                    }
                }

                if (beforeResponse && afterResponse) {
                    if (afterResponse.statusCode !== beforeResponse.statusCode) {
                        stage.changes = {
                            ...stage.changes,
                            responseStatusCode: afterResponse.statusCode,
                            responseStatusCodeBefore: beforeResponse.statusCode,
                            responseStatusCodeAfter: afterResponse.statusCode,
                        }
                    }
                    if (hasDifferentHeaders(beforeResponse.headers, afterResponse.headers)) {
                        stage.changes = {
                            ...stage.changes,
                            responseHeaders: afterResponse.headers,
                            responseHeadersBefore: beforeResponse.headers,
                            responseHeadersAfter: afterResponse.headers,
                        }
                    }
                    if (afterResponse.body !== beforeResponse.body) {
                        stage.changes = {
                            ...stage.changes,
                            responseBody: afterResponse.body,
                            responseBodyBefore: beforeResponse.body,
                            responseBodyAfter: afterResponse.body,
                        }
                    }
                }

                if (afterShortCircuited && !beforeShortCircuited) {
                    stage.shortCircuited = true
                    stage.status = 'short-circuited'
                    const shortCircuitResponse = contextAfter.shortCircuitResponse
                    if (shortCircuitResponse) {
                        stage.changes = {
                            ...stage.changes,
                            responseStatusCode: shortCircuitResponse.statusCode,
                            responseStatusCodeAfter: shortCircuitResponse.statusCode,
                            responseHeadersBefore: {},
                            responseHeaders: normalizeHeaders(shortCircuitResponse.headers as Record<string, string | string[] | undefined>),
                            responseHeadersAfter: normalizeHeaders(shortCircuitResponse.headers as Record<string, string | string[] | undefined>),
                            responseBodyBefore: '',
                            responseBody: typeof shortCircuitResponse.body === 'string' ? shortCircuitResponse.body : '',
                            responseBodyAfter: typeof shortCircuitResponse.body === 'string' ? shortCircuitResponse.body : '',
                        }
                    }
                }

                stages.push(stage)
            }
        }

        return results
    } catch (error: any) {
        logger.error(
            `[pipeline] dispatch ${hookName} failed:`,
            error && error.message ? error.message : error
        )

        if (stages) {
            stages.push({
                name: 'pipeline',
                type: 'system',
                hook: hookName,
                status: 'error',
                duration: 0,
                error: error?.message || String(error),
            })
        }

        return []
    }
}

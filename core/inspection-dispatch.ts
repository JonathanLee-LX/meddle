import { InspectionStage, HookContext, ResponseContext, Logger } from './types'

function normalizeHeaders(headers: Record<string, any> | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!headers || typeof headers !== 'object') return out
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue
        out[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    return out
}

function cloneResponse(response: any) {
    if (!response || typeof response !== 'object') return null
    return {
        statusCode: response.statusCode || 200,
        headers: normalizeHeaders(response.headers),
        body: typeof response.body === 'string' ? response.body : String(response.body || ''),
    }
}

function hasDifferentHeaders(a: Record<string, string>, b: Record<string, string>): boolean {
    return JSON.stringify(a) !== JSON.stringify(b)
}

export async function dispatchWithInspection(
    dispatcher: any,
    logger: Logger,
    hookName: string,
    context: HookContext | ResponseContext,
): Promise<any[]> {
    const stages = (context as HookContext).meta?._inspectionStages as InspectionStage[] | undefined
    const prevTarget = (context as HookContext).target
    const prevShortCircuited = (context as HookContext).shortCircuited
    const prevRequestHeaders = normalizeHeaders((context as any).request?.headers)
    const prevResponse = cloneResponse((context as any).response)

    try {
        const results = await dispatcher.dispatch(hookName, context)

        if (stages && Array.isArray(results)) {
            const nextRequestHeaders = normalizeHeaders((context as any).request?.headers)
            const nextResponse = cloneResponse((context as any).response)

            for (const result of results) {
                const stage: InspectionStage = {
                    name: result.pluginId || 'unknown',
                    type: result.pluginId?.startsWith('builtin.') ? 'builtin' : 'custom',
                    hook: hookName,
                    status: result.status === 'ok' ? 'ok' : result.status === 'skipped-disabled' ? 'skipped' : 'error',
                    duration: result.duration || 0,
                    target: (context as HookContext).target,
                    error: result.error,
                }

                if ((context as HookContext).target !== prevTarget) {
                    stage.changes = {
                        ...stage.changes,
                        target: (context as HookContext).target,
                        targetBefore: prevTarget,
                        targetAfter: (context as HookContext).target,
                    }
                }

                if (hasDifferentHeaders(prevRequestHeaders, nextRequestHeaders)) {
                    stage.changes = {
                        ...stage.changes,
                        requestHeaders: nextRequestHeaders,
                        requestHeadersBefore: prevRequestHeaders,
                        requestHeadersAfter: nextRequestHeaders,
                    }
                }

                if (nextResponse && prevResponse) {
                    if (nextResponse.statusCode !== prevResponse.statusCode) {
                        stage.changes = {
                            ...stage.changes,
                            responseStatusCode: nextResponse.statusCode,
                            responseStatusCodeBefore: prevResponse.statusCode,
                            responseStatusCodeAfter: nextResponse.statusCode,
                        }
                    }
                    if (hasDifferentHeaders(prevResponse.headers, nextResponse.headers)) {
                        stage.changes = {
                            ...stage.changes,
                            responseHeaders: nextResponse.headers,
                            responseHeadersBefore: prevResponse.headers,
                            responseHeadersAfter: nextResponse.headers,
                        }
                    }
                    if (nextResponse.body !== prevResponse.body) {
                        stage.changes = {
                            ...stage.changes,
                            responseBody: nextResponse.body,
                            responseBodyBefore: prevResponse.body,
                            responseBodyAfter: nextResponse.body,
                        }
                    }
                }

                if ((context as HookContext).shortCircuited && !prevShortCircuited) {
                    stage.shortCircuited = true
                    stage.status = 'short-circuited'
                    const shortCircuitResponse = (context as HookContext).shortCircuitResponse
                    if (shortCircuitResponse) {
                        stage.changes = {
                            ...stage.changes,
                            responseStatusCode: shortCircuitResponse.statusCode,
                            responseStatusCodeAfter: shortCircuitResponse.statusCode,
                            responseHeadersBefore: {},
                            responseHeaders: normalizeHeaders(shortCircuitResponse.headers as Record<string, any>),
                            responseHeadersAfter: normalizeHeaders(shortCircuitResponse.headers as Record<string, any>),
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

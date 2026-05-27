import { describe, it, expect } from 'vitest'
import zlib from 'zlib'
import { createPluginIntercept } from '../core/plugin-intercept'

function makeCtx(overrides: any = {}) {
    return {
        requestPipeline: { mode: 'off' },
        hookDispatcher: {
            dispatch: async () => {},
        },
        shadowCompareTracker: {
            record: () => false,
            getStats: () => ({ total: 0, diff: 0, diffRate: '0' }),
        },
        pipelineGate: {
            shouldApplyPipelineOnForSource: () => false,
            canUsePipelineExecuteForSource: () => false,
            shouldUsePluginMockForRequest: () => false,
        },
        SHADOW_WARN_MIN_SAMPLES: 10,
        SHADOW_WARN_DIFF_RATE: 0.5,
        ...overrides,
    }
}

describe('plugin-intercept createPluginIntercept', () => {
    describe('shouldInterceptResponse', () => {
        it('returns true only when pipeline mode is "on"', () => {
            const onCtx = makeCtx({ requestPipeline: { mode: 'on' } })
            const pi = createPluginIntercept(onCtx)
            expect(pi.shouldInterceptResponse()).toBe(true)
        })

        it('returns false when pipeline mode is "off"', () => {
            const pi = createPluginIntercept(makeCtx({ requestPipeline: { mode: 'off' } }))
            expect(pi.shouldInterceptResponse()).toBe(false)
        })

        it('returns true when pipeline mode is "shadow"', () => {
            const pi = createPluginIntercept(makeCtx({ requestPipeline: { mode: 'shadow' } }))
            expect(pi.shouldInterceptResponse()).toBe(true)
        })
    })

    describe('interceptResponseWithPlugins', () => {
        it('returns false for non-text content types', async () => {
            const pi = createPluginIntercept(makeCtx({ requestPipeline: { mode: 'on' } }))
            const result = await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: { writeHead: () => {}, end: () => {} },
                source: 'https://a.com', target: 'https://a.com',
                startTime: Date.now(), statusCode: 200,
                headers: { 'content-type': 'image/png' },
                bodyBuffer: Buffer.from('binary'), reqBody: Buffer.alloc(0),
            })
            expect(result).toBe(false)
        })

        it('intercepts and dispatches hooks for text content', async () => {
            const dispatched: string[] = []
            const ctx = makeCtx({
                requestPipeline: { mode: 'on' },
                hookDispatcher: {
                    dispatch: async (hook: string) => { dispatched.push(hook) },
                },
            })
            const pi = createPluginIntercept(ctx)

            let writtenStatus = 0
            let endedBody: Buffer | null = null
            const result = await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: {
                    writeHead: (s: number) => { writtenStatus = s },
                    end: (b: Buffer) => { endedBody = b },
                },
                source: 'https://a.com/api', target: 'https://a.com/api',
                startTime: Date.now(), statusCode: 200,
                headers: { 'content-type': 'application/json' },
                bodyBuffer: Buffer.from('{"ok":true}'), reqBody: Buffer.alloc(0),
            })
            expect(result).toBe(true)
            expect(writtenStatus).toBe(200)
            expect(endedBody).toBeTruthy()
            expect(dispatched.includes('onBeforeResponse')).toBeTruthy()
            expect(dispatched.includes('onAfterResponse')).toBeTruthy()
        })

        it('decompresses gzip content before passing to plugins', async () => {
            let capturedBody = ''
            const ctx = makeCtx({
                requestPipeline: { mode: 'on' },
                hookDispatcher: {
                    dispatch: async (_hook: string, ctx: any) => {
                        if (ctx && ctx.response) capturedBody = ctx.response.body
                    },
                },
            })
            const pi = createPluginIntercept(ctx)
            const gzipped = zlib.gzipSync(Buffer.from('hello world'))

            await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: { writeHead: () => {}, end: () => {} },
                source: 'https://a.com', target: 'https://a.com',
                startTime: Date.now(), statusCode: 200,
                headers: { 'content-type': 'text/plain', 'content-encoding': 'gzip' },
                bodyBuffer: gzipped, reqBody: Buffer.alloc(0),
            })
            expect(capturedBody).toBe('hello world')
        })

        it('applies cleanHeaders function when provided', async () => {
            const ctx = makeCtx({
                requestPipeline: { mode: 'on' },
                hookDispatcher: { dispatch: async () => {} },
            })
            const pi = createPluginIntercept(ctx)
            let writtenHeaders: any = null
            await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: {
                    writeHead: (_s: number, h: any) => { writtenHeaders = h },
                    end: () => {},
                },
                source: 'https://a.com', target: 'https://a.com',
                startTime: Date.now(), statusCode: 200,
                headers: { 'content-type': 'text/html', 'x-extra': 'val' },
                bodyBuffer: Buffer.from('<html></html>'), reqBody: Buffer.alloc(0),
                cleanHeaders: (h: any) => { const c = { ...h }; delete c['x-extra']; return c },
            })
            expect(writtenHeaders).toBeTruthy()
            expect(writtenHeaders['x-extra']).toBe(undefined)
        })

        it('appends response hook stages into inspection timeline', async () => {
            const inspectionMeta = { _inspectionStages: [] as any[] }
            const ctx = makeCtx({
                requestPipeline: { mode: 'on' },
                hookDispatcher: {
                    dispatch: async (hook: string, responseCtx: any) => {
                        if (hook === 'onBeforeResponse') {
                            responseCtx.response.headers['x-plugin'] = '1'
                        }
                        return [{
                            pluginId: 'local.custom',
                            status: 'ok',
                            duration: 4,
                        }]
                    },
                },
            })
            const pi = createPluginIntercept(ctx)

            await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: { writeHead: () => {}, end: () => {} },
                source: 'https://a.com', target: 'https://a.com',
                startTime: Date.now(), statusCode: 200,
                headers: { 'content-type': 'application/json' },
                bodyBuffer: Buffer.from('{"ok":true}'),
                reqBody: Buffer.alloc(0),
                inspectionMeta,
            })

            expect(inspectionMeta._inspectionStages).toHaveLength(2)
            expect(inspectionMeta._inspectionStages.map((stage: any) => stage.hook)).toEqual([
                'onBeforeResponse',
                'onAfterResponse',
            ])
            expect(inspectionMeta._inspectionStages[0].changes?.responseHeaders?.['x-plugin']).toBe('1')
        })

        it('runs response hooks in shadow mode without applying plugin response mutations', async () => {
            const dispatched: string[] = []
            const inspectionMeta = { _inspectionStages: [] as any[] }
            const ctx = makeCtx({
                requestPipeline: { mode: 'shadow' },
                hookDispatcher: {
                    dispatch: async (hook: string, responseCtx: any) => {
                        dispatched.push(hook)
                        if (hook === 'onBeforeResponse') {
                            responseCtx.response.statusCode = 299
                            responseCtx.response.headers['x-plugin'] = 'shadow'
                            responseCtx.response.body = '{"changed":true}'
                        }
                        return [{
                            pluginId: 'local.custom',
                            status: 'ok',
                            duration: 2,
                        }]
                    },
                },
            })
            const pi = createPluginIntercept(ctx)

            let writtenStatus = 0
            let writtenHeaders: any = null
            let endedBody: Buffer | null = null
            const originalBody = Buffer.from('{"ok":true}')
            await pi.interceptResponseWithPlugins({
                req: { method: 'GET', headers: {} },
                res: {
                    writeHead: (status: number, headers: any) => {
                        writtenStatus = status
                        writtenHeaders = headers
                    },
                    end: (body: Buffer) => { endedBody = body },
                },
                source: 'https://a.com',
                target: 'https://a.com',
                startTime: Date.now(),
                statusCode: 200,
                headers: { 'content-type': 'application/json', 'content-length': String(originalBody.length) },
                bodyBuffer: originalBody,
                reqBody: Buffer.alloc(0),
                inspectionMeta,
            })

            expect(dispatched).toEqual(['onBeforeResponse', 'onAfterResponse'])
            expect(writtenStatus).toBe(200)
            expect(writtenHeaders['x-plugin']).toBe(undefined)
            expect(writtenHeaders['content-length']).toBe(String(originalBody.length))
            expect(endedBody?.toString('utf-8')).toBe('{"ok":true}')
            expect(inspectionMeta._inspectionStages[0].changes?.responseBody).toBe('{"changed":true}')
        })
    })

    describe('delegation methods', () => {
        it('shouldApplyPipelineOnForSource delegates to pipelineGate', () => {
            const ctx = makeCtx({
                pipelineGate: { shouldApplyPipelineOnForSource: (s: string) => s.includes('allowed') },
            })
            const pi = createPluginIntercept(ctx)
            expect(pi.shouldApplyPipelineOnForSource('https://allowed.com')).toBe(true)
            expect(pi.shouldApplyPipelineOnForSource('https://blocked.com')).toBe(false)
        })

        it('canUsePipelineExecuteForSource delegates to pipelineGate', () => {
            const ctx = makeCtx({
                pipelineGate: { canUsePipelineExecuteForSource: () => true },
            })
            const pi = createPluginIntercept(ctx)
            expect(pi.canUsePipelineExecuteForSource('https://any.com')).toBe(true)
        })

        it('shouldUsePluginMockForRequest delegates to pipelineGate', () => {
            const ctx = makeCtx({
                pipelineGate: { shouldUsePluginMockForRequest: (_s: string, rule: any) => rule.bodyType === 'inline' },
            })
            const pi = createPluginIntercept(ctx)
            expect(pi.shouldUsePluginMockForRequest('url', { bodyType: 'inline' })).toBe(true)
            expect(pi.shouldUsePluginMockForRequest('url', { bodyType: 'file' })).toBe(false)
        })
    })

    describe('observeShadowDecision', () => {
        it('calls shadowCompareTracker.record', () => {
            let recorded = false
            const ctx = makeCtx({
                shadowCompareTracker: {
                    record: () => { recorded = true; return false },
                    getStats: () => ({ total: 0, diff: 0, diffRate: '0' }),
                },
            })
            const pi = createPluginIntercept(ctx)
            pi.observeShadowDecision('GET', 'https://a.com', 'https://b.com', 'https://b.com')
            expect(recorded).toBe(true)
        })
    })

    describe('emitLegacyResponseToPlugins', () => {
        it('dispatches onRequestStart and onAfterResponse', async () => {
            const dispatched: string[] = []
            const ctx = makeCtx({
                hookDispatcher: {
                    dispatch: async (hook: string) => { dispatched.push(hook) },
                },
            })
            const pi = createPluginIntercept(ctx)
            pi.emitLegacyResponseToPlugins({ method: 'GET', source: 'https://a.com', statusCode: 200, duration: 100 })
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(dispatched.includes('onRequestStart')).toBeTruthy()
            expect(dispatched.includes('onAfterResponse')).toBeTruthy()
        })
    })

    describe('emitLegacyErrorToPlugins', () => {
        it('dispatches onError hook', async () => {
            let errorDispatched = false
            const ctx = makeCtx({
                hookDispatcher: {
                    dispatch: async (hook: string) => { if (hook === 'onError') errorDispatched = true },
                },
            })
            const pi = createPluginIntercept(ctx)
            pi.emitLegacyErrorToPlugins('testPhase', new Error('test'))
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(errorDispatched).toBe(true)
        })
    })
})

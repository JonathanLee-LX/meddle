import { describe, it, expect } from 'vitest'
import { createPipeline, normalizeMode } from '../core/pipeline'
import { PluginManager, HookDispatcher } from '../core/plugin-runtime'

describe('pipeline normalizeMode', () => {
    it('falls back to off for unsupported modes', () => {
        expect(normalizeMode('x')).toBe('off')
        expect(normalizeMode(undefined)).toBe('off')
    })
})

describe('pipeline inspection', () => {
    it('collects plugin execution stages in on mode', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(_hook: string, _ctx: any) {
                    // 返回插件执行结果，模拟 pipeline 收集
                    return [{
                        pluginId: 'test.plugin',
                        status: 'ok',
                        duration: 5,
                    }]
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://test.com' },
            'https://test.com'
        )

        // 检查 meta 中是否包含 inspection 信息
        expect(result.meta).toBeDefined()
        expect(result.meta._inspectionStages).toBeDefined()
        expect(Array.isArray(result.meta._inspectionStages)).toBe(true)
    })

    it('passes inspection stages through execute', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(_hook: string, ctx: any) {
                    if (_hook === 'onBeforeProxy') {
                        ctx.setTarget('https://modified.com')
                    }
                    return [{
                        pluginId: 'router.plugin',
                        status: 'ok',
                        duration: 3,
                    }]
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://test.com' },
            initialTarget: 'https://test.com',
            executeUpstream: async (target) => ({ response: { statusCode: 200, headers: {}, body: target } }),
        })

        expect(result.meta).toBeDefined()
        expect(result.meta._inspectionStages).toBeDefined()
        expect(result.meta._inspectionStages.length).toBeGreaterThan(0)
    })

    it('includes target changes in inspection stages', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(_hook: string, ctx: any) {
                    if (_hook === 'onBeforeProxy') {
                        ctx.setTarget('https://new-target.com')
                    }
                    return [{
                        pluginId: 'router.plugin',
                        status: 'ok',
                        duration: 2,
                    }]
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://test.com' },
            'https://test.com'
        )

        const stages = result.meta._inspectionStages
        expect(stages).toBeDefined()
        // 查找包含 target 变化的 stage
        const targetChangeStage = stages.find((s: any) => s.changes?.target === 'https://new-target.com')
        expect(targetChangeStage).toBeDefined()
    })

    it('records short-circuit in inspection stages', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(_hook: string, ctx: any) {
                    if (_hook === 'onBeforeProxy') {
                        ctx.respond({ statusCode: 200, headers: { 'X-Test': '1' }, body: 'short-circuit' })
                    }
                    return [{
                        pluginId: 'mock.plugin',
                        status: 'ok',
                        duration: 1,
                    }]
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://test.com' },
            'https://test.com'
        )

        expect(result.shortCircuited).toBe(true)
        const stages = result.meta._inspectionStages
        expect(stages).toBeDefined()
        // 查找 short-circuited 的 stage
        const shortCircuitStage = stages.find((s: any) => s.shortCircuited === true)
        expect(shortCircuitStage).toBeDefined()
        expect(shortCircuitStage.changes?.responseHeadersBefore).toEqual({})
        expect(shortCircuitStage.changes?.responseHeadersAfter).toEqual({ 'X-Test': '1' })
        expect(shortCircuitStage.changes?.responseBodyBefore).toBe('')
        expect(shortCircuitStage.changes?.responseBodyAfter).toBe('short-circuit')
    })

    it('records errors in inspection stages', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch() {
                    throw new Error('Test error')
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://test.com' },
            'https://test.com'
        )

        // 即使有错误，也应该有 inspection 信息
        expect(result.meta).toBeDefined()
        expect(result.meta._inspectionStages).toBeDefined()
        // pipeline 错误阶段
        const errorStage = result.meta._inspectionStages.find((s: any) => s.status === 'error')
        expect(errorStage).toBeDefined()
        expect(errorStage.error).toContain('Test error')
    })

    it('provides log interface in hook context', async () => {
        let receivedCtx: any = null
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(_hook: string, ctx: any) {
                    receivedCtx = ctx
                    return []
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://test.com' },
            'https://test.com'
        )

        expect(receivedCtx).toBeDefined()
        expect(receivedCtx.log).toBeDefined()
        expect(typeof receivedCtx.log.info).toBe('function')
        expect(typeof receivedCtx.log.error).toBe('function')
    })

    it('records response-stage changes in inspection stages', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(hook: string, ctx: any) {
                    if (hook === 'onBeforeResponse') {
                        ctx.response.statusCode = 201
                        ctx.response.headers['x-inspected'] = 'yes'
                        ctx.response.body = 'modified body'
                    }
                    return [{
                        pluginId: 'local.response',
                        status: 'ok',
                        duration: 3,
                    }]
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async () => ({ response: { statusCode: 200, headers: {}, body: 'original body' } }),
        })

        const responseStage = result.meta._inspectionStages.find((stage: any) => stage.hook === 'onBeforeResponse')
        expect(responseStage).toBeDefined()
        expect(responseStage.changes?.responseStatusCode).toBe(201)
        expect(responseStage.changes?.responseHeaders?.['x-inspected']).toBe('yes')
        expect(responseStage.changes?.responseBody).toBe('modified body')
    })

    it('attributes response diffs to the plugin that actually changed them', async () => {
        const manager = new PluginManager({ logger: { error() {} } })
        manager.register({
            manifest: {
                id: 'local.cors',
                version: '1.0.0',
                apiVersion: '1.x',
                permissions: [],
                hooks: ['onBeforeResponse'],
                priority: 100,
            },
            async setup() {},
            async onBeforeResponse(ctx: any) {
                ctx.response.headers['access-control-allow-origin'] = 'https://app.example.com'
            },
        })
        manager.register({
            manifest: {
                id: 'local.inject-eruda',
                version: '1.0.0',
                apiVersion: '1.x',
                permissions: [],
                hooks: ['onBeforeResponse'],
                priority: 110,
            },
            async setup() {},
            async onBeforeResponse(ctx: any) {
                ctx.response.body = `${ctx.response.body}\n<script src="https://cdn.jsdelivr.net/npm/eruda"></script>`
            },
        })
        await manager.setup(() => ({}))
        await manager.start()

        const dispatcher = new HookDispatcher(manager, {
            logger: { error() {} },
            defaultTimeoutMs: 30,
        })

        const pipeline = createPipeline({
            mode: 'on',
            dispatcher,
            pluginManager: manager,
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async () => ({
                response: { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>' },
            }),
        })

        const corsStage = result.meta._inspectionStages.find((stage: any) => stage.name === 'local.cors')
        const erudaStage = result.meta._inspectionStages.find((stage: any) => stage.name === 'local.inject-eruda')

        expect(corsStage.changes?.responseHeadersAfter?.['access-control-allow-origin']).toBe('https://app.example.com')
        expect(corsStage.changes?.responseBodyAfter).toBeUndefined()
        expect(erudaStage.changes?.responseBodyAfter).toContain('eruda')
        expect(erudaStage.changes?.responseHeadersAfter).toBeUndefined()
    })
})

describe('pipeline execute', () => {
    it('off mode bypasses dispatcher and keeps target', async () => {
        const calls = []
        const pipeline = createPipeline({
            mode: 'off',
            dispatcher: {
                async dispatch() {
                    calls.push('dispatch')
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async (target) => ({ response: { statusCode: 200, headers: {}, body: target } }),
        })

        expect(calls.length).toBe(0)
        expect(result.response.body).toBe('https://a.com')
    })

    it('shadow mode runs hooks but does not alter upstream target', async () => {
        const hookTargets = []
        const pipeline = createPipeline({
            mode: 'shadow',
            dispatcher: {
                async dispatch(_hook, ctx) {
                    ctx.setTarget('https://modified.example.com')
                    hookTargets.push(ctx.target)
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async (target) => ({ response: { statusCode: 200, headers: {}, body: target } }),
        })

        expect(hookTargets.length >= 1).toBeTruthy()
        expect(result.response.body).toBe('https://a.com')
    })

    it('on mode applies target rewrite before upstream', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(hook, ctx) {
                    if (hook === 'onBeforeProxy') {
                        ctx.setTarget('https://rewritten.example.com')
                    }
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async (target) => ({ response: { statusCode: 200, headers: {}, body: target } }),
        })

        expect(result.target).toBe('https://rewritten.example.com')
        expect(result.response.body).toBe('https://rewritten.example.com')
    })

    it('on mode supports short-circuit responses', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(hook, ctx) {
                    if (hook === 'onBeforeProxy') {
                        ctx.respond({ statusCode: 201, headers: { 'x-mock': '1' }, body: 'mocked' })
                    }
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })

        let executed = false
        const result = await pipeline.execute({
            request: { method: 'GET', url: 'https://a.com' },
            initialTarget: 'https://a.com',
            executeUpstream: async () => {
                executed = true
                return { response: { statusCode: 200, headers: {}, body: 'upstream' } }
            },
        })

        expect(executed).toBe(false)
        expect(result.shortCircuited).toBe(true)
        expect(result.response.statusCode).toBe(201)
        expect(result.response.body).toBe('mocked')
    })
})

describe('pipeline evaluateRequest', () => {
    it('returns observed target in shadow mode', async () => {
        const pipeline = createPipeline({
            mode: 'shadow',
            dispatcher: {
                async dispatch(hook, ctx) {
                    if (hook === 'onBeforeProxy') {
                        ctx.setTarget('https://observed.example.com')
                    }
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })
        const decision = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://a.com' },
            'https://legacy.example.com'
        )
        expect(decision.target).toBe('https://legacy.example.com')
        expect(decision.observedTarget).toBe('https://observed.example.com')
    })

    it('returns short-circuit decision in on mode', async () => {
        const pipeline = createPipeline({
            mode: 'on',
            dispatcher: {
                async dispatch(hook, ctx) {
                    if (hook === 'onBeforeProxy') {
                        ctx.respond({ statusCode: 202, headers: {}, body: 'ok' })
                    }
                },
            },
            pluginManager: {},
            logger: { error() {} },
        })
        const decision = await pipeline.evaluateRequest(
            { method: 'GET', url: 'https://a.com' },
            'https://a.com'
        )
        expect(decision.shortCircuited).toBe(true)
        expect(decision.response!.statusCode).toBe(202)
    })
})

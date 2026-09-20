import path from 'path'
import fs from 'fs'
import os from 'os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMockHandler, dedupeMockRulesById } from '../core/mock-handler'

function makeCtx(overrides: any = {}) {
    const tmpDir = overrides.meddleDir || os.tmpdir()
    return {
        meddleDir: tmpDir, certDir: tmpDir, settingsPath: path.join(tmpDir, 'settings-test-mh.json'),
        AUTO_OPEN: false, REFACTOR_CONFIG: {}, INITIAL_PLUGIN_MODE: 'off' as const,
        MAX_RECORD_SIZE: 100, MAX_DETAIL_SIZE: 50, MAX_BODY_SIZE: 1024 * 1024,
        MAX_DETAIL_BODY_SIZE: 1024 * 1024,
        resolveDetailBodySizeBytes: () => 1024 * 1024,
        SHADOW_WARN_MIN_SAMPLES: 10, SHADOW_WARN_DIFF_RATE: 0.5,
        PLUGIN_ON_HOSTS: new Set<string>(), ENABLE_BUILTIN_ROUTER_PLUGIN: false,
        ENABLE_BUILTIN_LOGGER_PLUGIN: false, ENABLE_BUILTIN_MOCK_PLUGIN: false,
        pluginManager: {}, hookDispatcher: {}, requestPipeline: { mode: 'off' },
        builtinLoggerPlugin: {}, shadowCompareTracker: {}, onModeGate: {}, pipelineGate: {},
        ruleMap: {}, currentMocksPath: null as string | null, mockRules: [] as any[], mockIdSeq: 1,
        proxyRecordArr: [] as any[], recordIdSeq: 0,
        proxyRecordDetailMap: new Map(), httpsServerMap: new Map(),
        localWSServer: null,
        ...overrides,
    }
}

describe('mock-handler createMockHandler', () => {
    let tmpDir: string

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-mh-test-'))
    })
    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    describe('matchMockRule', () => {
        it('returns null when no rules match', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'Test', urlPattern: 'example\\.com/api', method: 'GET', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            expect(handler.matchMockRule('https://other.com/foo', 'GET')).toBe(null)
        })

        it('matches by regex urlPattern', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'API', urlPattern: 'example\\.com/api', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            const match = handler.matchMockRule('https://example.com/api/data', 'GET')
            expect(match).toBeTruthy()
            expect(match!.id).toBe(1)
        })

        it('skips disabled rules', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'Disabled', urlPattern: '.*', method: '*', enabled: false, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            expect(handler.matchMockRule('https://any.com', 'GET')).toBe(null)
        })

        it('filters by HTTP method', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'POST only', urlPattern: '.*', method: 'POST', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            expect(handler.matchMockRule('https://any.com', 'GET')).toBe(null)
            expect(handler.matchMockRule('https://any.com', 'POST')).toBeTruthy()
        })

        it('method matching is case-insensitive', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'Test', urlPattern: '.*', method: 'get', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            expect(handler.matchMockRule('https://any.com', 'GET')).toBeTruthy()
        })

        it('falls back to string inclusion for invalid regex', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'Bad regex', urlPattern: '[invalid', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }
            ]
            expect(handler.matchMockRule('url-with-[invalid-pattern', 'GET')).toBeTruthy()
            expect(handler.matchMockRule('https://clean.com', 'GET')).toBe(null)
        })

        it('matches same path with different query via rule.query', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'A', urlPattern: '/ops/.*/policy', query: 'window_key=A', method: 'GET', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{"k":"A"}' },
                { id: 2, name: 'B', urlPattern: '/ops/.*/policy', query: 'window_key=B', method: 'GET', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{"k":"B"}' },
            ]
            const urlA = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=A'
            const urlB = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=B'
            expect(handler.matchMockRule(urlA, 'GET')!.id).toBe(1)
            expect(handler.matchMockRule(urlB, 'GET')!.id).toBe(2)
            expect(handler.matchMockRule(urlA, 'GET')!.body).toBe('{"k":"A"}')
            expect(handler.matchMockRule(urlB, 'GET')!.body).toBe('{"k":"B"}')
        })

        it('matches query embedded in urlPattern regex', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            ctx.mockRules = [
                { id: 1, name: 'Banner', urlPattern: 'policy\\?window_key=open_recharge_activity_banner', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{"banner":true}' },
            ]
            const hit = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=open_recharge_activity_banner'
            const miss = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=other'
            expect(handler.matchMockRule(hit, 'GET')).toBeTruthy()
            expect(handler.matchMockRule(miss, 'GET')).toBe(null)
        })
    })

    describe('buildMockResponseForTest', () => {
        it('builds response with default content-type', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = { id: 1, name: 'Test', urlPattern: '.*', method: '*', enabled: true, statusCode: 201, delay: 0, bodyType: 'inline', headers: {}, body: '{"ok":true}' }
            const resp = handler.buildMockResponseForTest(rule)
            expect(resp.statusCode).toBe(201)
            expect(resp.headers['content-type']).toBe('application/json')
            expect(resp.body).toBe('{"ok":true}')
        })

        it('uses custom content-type from rule headers', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = { id: 1, name: 'Test', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: { 'Content-Type': 'text/plain' }, body: 'hello' }
            const resp = handler.buildMockResponseForTest(rule)
            expect(resp.headers['content-type']).toBe('text/plain')
            expect(resp.body).toBe('hello')
        })

        it('replaces base64 body with placeholder', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = { id: 1, name: 'Test', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: 'data:image/png;base64,iVBOR' }
            const resp = handler.buildMockResponseForTest(rule)
            expect(resp.body).toBe('(base64 mock body)')
        })

        it('includes x-mock-rule header', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = { id: 5, name: 'MyRule', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '' }
            const resp = handler.buildMockResponseForTest(rule)
            expect(resp.headers['x-mock-rule']).toBe('MyRule')
        })

        it('resolves {origin} placeholder from request headers', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = {
                id: 1, name: 'CORS', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0,
                bodyType: 'inline',
                headers: {
                    'Access-Control-Allow-Origin': '{origin}',
                    'Access-Control-Allow-Credentials': 'true',
                },
                body: '{}',
            }
            const resp = handler.buildMockResponseForTest(rule, { origin: 'https://open.wps.cn' })
            expect(resp.headers['access-control-allow-origin']).toBe('https://open.wps.cn')
            expect(resp.headers['access-control-allow-credentials']).toBe('true')
        })
    })

    describe('dedupeMockRulesById', () => {
        it('keeps the last rule per id when duplicates exist', () => {
            const rules = [
                { id: 1, name: 'old', urlPattern: 'a', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '' },
                { id: 2, name: 'b', urlPattern: 'b', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '' },
                { id: 1, name: 'new', urlPattern: 'a', method: '*', enabled: false, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '' },
            ]
            const deduped = dedupeMockRulesById(rules as any)
            expect(deduped).toHaveLength(2)
            expect(deduped.find((r) => r.id === 1)?.name).toBe('new')
            expect(deduped.find((r) => r.id === 1)?.enabled).toBe(false)
        })
    })

    describe('loadMockRules / saveMockRules', () => {
        it('loads and saves mock rules via file', () => {
            const mockFile = path.join(tmpDir, 'mocks-test.json')
            const rules = [{ id: 1, name: 'R1', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' }]
            fs.writeFileSync(mockFile, JSON.stringify({ nextId: 2, rules }), 'utf8')

            const ctx = makeCtx({ meddleDir: tmpDir, currentMocksPath: mockFile })
            const handler = createMockHandler(ctx)
            handler.loadMockRules()

            expect(ctx.mockRules.length).toBe(1)
            expect(ctx.mockRules[0].name).toBe('R1')
            expect(ctx.mockIdSeq).toBe(3)

            ctx.mockRules.push({ id: 2, name: 'R2', urlPattern: '/api', method: 'GET', enabled: true, statusCode: 201, delay: 0, bodyType: 'inline', headers: {}, body: 'ok' })
            ctx.mockIdSeq = 3
            handler.saveMockRules()

            const saved = JSON.parse(fs.readFileSync(mockFile, 'utf8'))
            expect(saved.rules.length).toBe(2)
            expect(saved.nextId).toBe(3)
        })

        it('dedupes duplicate ids when loading from file', () => {
            const mockFile = path.join(tmpDir, 'mocks-dup.json')
            const rules = [
                { id: 1, name: 'old', urlPattern: '.*', method: '*', enabled: true, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' },
                { id: 1, name: 'new', urlPattern: '.*', method: '*', enabled: false, statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '{}' },
            ]
            fs.writeFileSync(mockFile, JSON.stringify({ nextId: 2, rules }), 'utf8')

            const ctx = makeCtx({ meddleDir: tmpDir, currentMocksPath: mockFile })
            const handler = createMockHandler(ctx)
            handler.loadMockRules()

            expect(ctx.mockRules).toHaveLength(1)
            expect(ctx.mockRules[0].name).toBe('new')
            expect(ctx.mockRules[0].enabled).toBe(false)
        })
    })

    describe('getMockFilePath', () => {
        it('uses currentMocksPath if set', () => {
            const ctx = makeCtx({ meddleDir: tmpDir, currentMocksPath: '/custom/path.json' })
            const handler = createMockHandler(ctx)
            expect(handler.getMockFilePath()).toBe('/custom/path.json')
        })

        it('falls back to default meddleDir/mocks.json', () => {
            const ctx = makeCtx({ meddleDir: tmpDir, currentMocksPath: null })
            const handler = createMockHandler(ctx)
            const result = handler.getMockFilePath()
            expect(result.endsWith('mocks.json')).toBeTruthy()
            expect(result.startsWith(tmpDir)).toBeTruthy()
        })
    })

    describe('sendMockResponse inspection', () => {
        it('writes short-circuit inspection diff fields for direct mock responses', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = {
                id: 1,
                name: 'MockRule',
                urlPattern: '.*',
                method: 'POST',
                enabled: true,
                statusCode: 201,
                delay: 0,
                bodyType: 'inline',
                headers: { 'x-mock-rule': 'MockRule' },
                body: '{"ok":true}',
            }

            let writtenStatus = 0
            let endedBody = ''

            handler.sendMockResponse(
                {
                    headers: { host: 'example.com' },
                    on: () => {},
                    resume: () => {},
                },
                {
                    writeHead: (status: number) => { writtenStatus = status },
                    end: (body: string) => { endedBody = body },
                },
                rule as any,
                { method: 'POST', source: 'https://example.com/api', target: 'https://example.com/api' },
            )

            expect(writtenStatus).toBe(201)
            expect(endedBody).toBe('{"ok":true}')

            const detail = ctx.proxyRecordDetailMap.get(0)
            expect(detail?.inspection?.stages).toHaveLength(1)
            expect(detail?.inspection?.stages[0].status).toBe('short-circuited')
            expect(detail?.inspection?.stages[0].changes?.responseStatusCodeAfter).toBe(201)
            expect(detail?.inspection?.stages[0].changes?.responseHeadersBefore).toEqual({})
            expect(detail?.inspection?.stages[0].changes?.responseHeadersAfter?.['x-mock-rule']).toBe('MockRule')
            expect(detail?.inspection?.stages[0].changes?.responseBodyBefore).toBe('')
            expect(detail?.inspection?.stages[0].changes?.responseBodyAfter).toBe('{"ok":true}')
        })

        it('echoes request Origin when header value is {origin}', () => {
            const ctx = makeCtx({ meddleDir: tmpDir })
            const handler = createMockHandler(ctx)
            const rule = {
                id: 1,
                name: 'CorsEcho',
                urlPattern: '.*',
                method: 'GET',
                enabled: true,
                statusCode: 200,
                delay: 0,
                bodyType: 'inline',
                headers: {
                    'Access-Control-Allow-Origin': '{origin}',
                    'Access-Control-Allow-Credentials': 'true',
                },
                body: '{"ok":true}',
            }
            let writtenHeaders: Record<string, string> = {}
            handler.sendMockResponse(
                {
                    headers: { host: 'plus.wps.cn', origin: 'https://solution.wps.cn' },
                    on: () => {},
                    resume: () => {},
                },
                {
                    writeHead: (_status: number, headers: Record<string, string>) => { writtenHeaders = headers },
                    end: () => {},
                },
                rule as any,
                { method: 'GET', source: 'https://plus.wps.cn/api', target: 'https://plus.wps.cn/api' },
            )
            expect(writtenHeaders['access-control-allow-origin'] || writtenHeaders['Access-Control-Allow-Origin']).toBe('https://solution.wps.cn')
            expect(writtenHeaders['access-control-allow-credentials'] || writtenHeaders['Access-Control-Allow-Credentials']).toBe('true')
        })
    })
})

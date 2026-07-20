import { describe, it, expect } from 'vitest'
import { createBuiltinMockPlugin } from '../plugins/builtin/mock-plugin'

describe('builtin mock plugin', () => {
    it('short-circuits inline mock response', async () => {
        const plugin = createBuiltinMockPlugin({
            findMatch: () => ({
                id: 1,
                name: 'm1',
                statusCode: 201,
                headers: { 'x-test': '1' },
                bodyType: 'inline',
                body: '{"ok":true}',
            }),
        })
        let shortRes = null
        const ctx = {
            request: { method: 'GET', url: 'https://a.com/api' },
            meta: {},
            respond(res) {
                shortRes = res
            },
        }
        await plugin.onBeforeProxy(ctx)
        expect(shortRes).toBeTruthy()
        expect(shortRes.statusCode).toBe(201)
        expect(shortRes.headers['x-test']).toBe('1')
        expect(shortRes.body).toBe('{"ok":true}')
        expect((ctx.meta as any).mockRuleId).toBe(1)
    })

    it('skips non-inline file mock rules', async () => {
        const plugin = createBuiltinMockPlugin({
            findMatch: () => ({
                id: 2,
                bodyType: 'file',
                body: '/tmp/a.json',
            }),
        })
        let called = false
        const ctx = {
            request: { method: 'GET', url: 'https://a.com/api' },
            meta: {},
            respond() {
                called = true
            },
        }
        await plugin.onBeforeProxy(ctx)
        expect(called).toBe(false)
    })

    it('applies configured delay before short-circuit', async () => {
        const plugin = createBuiltinMockPlugin({
            findMatch: () => ({
                id: 3,
                bodyType: 'inline',
                delay: 15,
                body: '{"d":1}',
            }),
        })
        let calledAt = 0
        const start = Date.now()
        await plugin.onBeforeProxy({
            request: { method: 'GET', url: 'https://a.com/api' },
            meta: {},
            respond() {
                calledAt = Date.now()
            },
        })
        expect(calledAt - start >= 10).toBeTruthy()
    })
})

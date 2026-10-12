import { describe, expect, it } from 'vitest'
import { createMockRule, deleteMockRule, updateMockRule } from '../server/mocks'

/** Issue #123: a failed write restores in-memory mocks deeply, not just the array. */
function makeCtx(mutateOnSave: (ctx: any) => void) {
    const ctx: any = {
        mockIdSeq: 3,
        mockRules: [
            { id: 1, name: 'a', urlPattern: '/a', query: '', method: '*', statusCode: 200, delay: 0, bodyType: 'inline', headers: { 'x-a': '1' }, body: '', enabled: true },
            { id: 2, name: 'b', urlPattern: '/b', query: '', method: '*', statusCode: 200, delay: 0, bodyType: 'inline', headers: {}, body: '', enabled: true },
        ],
        broadcastToAllClients: () => { throw new Error('must not broadcast on failure') },
    }
    ctx.saveMockRules = () => { mutateOnSave(ctx); throw new Error('disk full') }
    return ctx
}

describe('mocks rollback on failed write (issue #123)', () => {
    const corrupt = (ctx: any) => {
        // what a save step may do in place (e.g. re-id / normalise) before failing
        for (const r of ctx.mockRules) { r.id += 100; r.headers['x-mut'] = 'y'; r.name = 'mutated' }
        ctx.mockIdSeq = 999
    }

    it.each([
        ['create', (ctx: any) => createMockRule(ctx, { name: 'c', urlPattern: '/c' })],
        ['update', (ctx: any) => updateMockRule(ctx, 1, { name: 'edited' })],
        ['delete', (ctx: any) => deleteMockRule(ctx, 2)],
    ])('%s: memory fully restored', (_n, op) => {
        const ctx = makeCtx(corrupt)
        const before = structuredClone(ctx.mockRules)
        expect(() => op(ctx)).toThrow('disk full')
        expect(ctx.mockRules).toEqual(before)
        expect(ctx.mockIdSeq).toBe(3)
    })
})

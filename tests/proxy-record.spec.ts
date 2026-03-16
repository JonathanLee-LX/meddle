import { describe, it, expect, vi } from 'vitest'
import { appendProxyRecord } from '../core/proxy-record'

function makeCtx(overrides: any = {}) {
    return {
        MAX_RECORD_SIZE: 2,
        MAX_DETAIL_SIZE: 2,
        proxyRecordArr: [] as any[],
        proxyRecordDetailMap: new Map(),
        localWSServer: null,
        ...overrides,
    }
}

describe('appendProxyRecord', () => {
    it('appends log records and details', () => {
        const ctx = makeCtx()
        appendProxyRecord(ctx, {
            id: 1,
            method: 'GET',
            source: 'https://a.test',
            target: 'https://b.test',
            time: '10:00:00',
            statusCode: 200,
            duration: 12,
        }, {
            requestHeaders: {},
            responseHeaders: {},
            statusCode: 200,
            method: 'GET',
            url: 'https://a.test',
        })

        expect(ctx.proxyRecordArr).toHaveLength(1)
        expect(ctx.proxyRecordDetailMap.get(1)?.statusCode).toBe(200)
    })

    it('broadcasts to websocket clients when available', () => {
        const send = vi.fn()
        const ctx = makeCtx({
            localWSServer: {
                clients: [{ readyState: 1, send }],
            },
        })

        appendProxyRecord(ctx, {
            id: 1,
            method: 'GET',
            source: 'https://a.test',
            target: 'https://b.test',
            time: '10:00:00',
        })

        expect(send).toHaveBeenCalledTimes(1)
    })

    it('evicts oldest records and their details', () => {
        const ctx = makeCtx()
        appendProxyRecord(ctx, { id: 1, method: 'GET', source: 'a', target: 'b', time: '1' }, {
            requestHeaders: {},
            responseHeaders: {},
            statusCode: 200,
            method: 'GET',
            url: 'a',
        })
        appendProxyRecord(ctx, { id: 2, method: 'GET', source: 'a', target: 'b', time: '2' }, {
            requestHeaders: {},
            responseHeaders: {},
            statusCode: 200,
            method: 'GET',
            url: 'a',
        })
        appendProxyRecord(ctx, { id: 3, method: 'GET', source: 'a', target: 'b', time: '3' }, {
            requestHeaders: {},
            responseHeaders: {},
            statusCode: 200,
            method: 'GET',
            url: 'a',
        })

        expect(ctx.proxyRecordArr.map((item: any) => item.id)).toEqual([2, 3])
        expect(ctx.proxyRecordDetailMap.has(1)).toBe(false)
        expect(ctx.proxyRecordDetailMap.has(2)).toBe(true)
        expect(ctx.proxyRecordDetailMap.has(3)).toBe(true)
    })
})

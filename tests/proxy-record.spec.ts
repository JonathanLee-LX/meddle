import { describe, it, expect, vi } from 'vitest'
import { appendProxyRecord, appendUpstreamErrorRecord, formatUpstreamError } from '../core/proxy-record'

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

describe('formatUpstreamError', () => {
    it('includes the code when the message does not', () => {
        const err = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
        expect(formatUpstreamError(err)).toBe('ECONNREFUSED: connect failed')
    })

    it('does not duplicate a code already in the message', () => {
        const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' })
        expect(formatUpstreamError(err)).toBe('connect ECONNREFUSED 127.0.0.1:9')
    })
})

describe('appendUpstreamErrorRecord', () => {
    it('appends a 502 with the error on both the list entry and the detail', () => {
        const ctx = makeCtx({ recordIdSeq: 7, MAX_RECORD_SIZE: 10, MAX_DETAIL_SIZE: 10 })
        const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })
        appendUpstreamErrorRecord(ctx, {
            method: 'GET',
            source: 'http://down.test/',
            target: 'http://127.0.0.1:1/',
            startTime: Date.now() - 20,
            err,
        })
        expect(ctx.recordIdSeq).toBe(8)
        expect(ctx.proxyRecordArr).toHaveLength(1)
        expect(ctx.proxyRecordArr[0].statusCode).toBe(502)
        const detail = ctx.proxyRecordDetailMap.get(7)
        expect(detail?.statusCode).toBe(502)
        expect(detail?.statusMessage).toBe('Bad Gateway')
        expect(detail?.error).toContain('ECONNREFUSED')
        expect(detail?.responseBody).toContain('ECONNREFUSED')
    })
})

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

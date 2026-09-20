import { describe, it, expect } from 'vitest'
import {
    extractUrlSearch,
    matchUrlPattern,
    matchQueryCondition,
    getRequestOrigin,
    resolveHeaderPlaceholders,
    corsCredentialHeaders,
} from '../core/mock-utils'

describe('mock-utils', () => {
    describe('extractUrlSearch', () => {
        it('extracts search from absolute URL', () => {
            expect(extractUrlSearch('https://a.com/api?window_key=A&x=1')).toBe('window_key=A&x=1')
        })
        it('extracts search from path-only URL', () => {
            expect(extractUrlSearch('/ops/policy?window_key=B')).toBe('window_key=B')
        })
        it('returns empty when no query', () => {
            expect(extractUrlSearch('https://a.com/api')).toBe('')
        })
        it('strips hash after query', () => {
            expect(extractUrlSearch('/api?q=1#hash')).toBe('q=1')
        })
    })

    describe('matchUrlPattern', () => {
        it('matches regex against full URL including query', () => {
            const url = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=open_recharge_activity_banner'
            expect(matchUrlPattern(url, 'policy\\?window_key=open_recharge_activity_banner')).toBe(true)
            expect(matchUrlPattern(url, 'policy\\?window_key=other')).toBe(false)
        })
        it('falls back to substring for invalid regex', () => {
            expect(matchUrlPattern('url-with-[invalid', '[invalid')).toBe(true)
        })
    })

    describe('matchQueryCondition', () => {
        const urlA = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=A&extra=1'
        const urlB = 'https://plus.wps.cn/ops/opsd/api/v3/policy?window_key=B'

        it('empty query matches any URL', () => {
            expect(matchQueryCondition(urlA, '')).toBe(true)
            expect(matchQueryCondition(urlA, undefined)).toBe(true)
            expect(matchQueryCondition('https://a.com/no-query', '')).toBe(true)
        })

        it('matches single query token', () => {
            expect(matchQueryCondition(urlA, 'window_key=A')).toBe(true)
            expect(matchQueryCondition(urlA, 'window_key=B')).toBe(false)
            expect(matchQueryCondition(urlB, 'window_key=B')).toBe(true)
        })

        it('requires all &-separated tokens', () => {
            expect(matchQueryCondition(urlA, 'window_key=A&extra=1')).toBe(true)
            expect(matchQueryCondition(urlA, 'window_key=A&extra=2')).toBe(false)
        })
    })

    describe('getRequestOrigin / resolveHeaderPlaceholders', () => {
        it('reads Origin header case-insensitively', () => {
            expect(getRequestOrigin({ origin: 'https://open.wps.cn' })).toBe('https://open.wps.cn')
            expect(getRequestOrigin({ Origin: 'https://solution.wps.cn' })).toBe('https://solution.wps.cn')
            expect(getRequestOrigin({})).toBe('*')
        })

        it('replaces {origin} placeholder in header values', () => {
            const headers = resolveHeaderPlaceholders(
                {
                    'Access-Control-Allow-Origin': '{origin}',
                    'X-Echo': 'from-{Origin}-ok',
                    'X-Static': 'keep',
                },
                { origin: 'https://localhost:5173' },
            )
            expect(headers['Access-Control-Allow-Origin']).toBe('https://localhost:5173')
            expect(headers['X-Echo']).toBe('from-https://localhost:5173-ok')
            expect(headers['X-Static']).toBe('keep')
        })

        it('corsCredentialHeaders uses {origin} template', () => {
            const cors = corsCredentialHeaders()
            expect(cors['Access-Control-Allow-Origin']).toBe('{origin}')
            expect(cors['Access-Control-Allow-Credentials']).toBe('true')
            const resolved = resolveHeaderPlaceholders(cors, { origin: 'https://open.wps.cn' })
            expect(resolved['Access-Control-Allow-Origin']).toBe('https://open.wps.cn')
        })
    })
})

import { describe, it, expect } from 'vitest'
import { cleanHeadersForH2, makeProxyRequest } from '../core/h2-pool'

describe('h2-pool cleanHeadersForH2', () => {
    it('removes hop-by-hop headers', () => {
        const input = {
            'Connection': 'keep-alive',
            'Keep-Alive': '5',
            'Transfer-Encoding': 'chunked',
            'Host': 'example.com',
            'content-type': 'text/html',
            'x-custom': 'value',
        }
        const result = cleanHeadersForH2(input)
        expect(result['connection']).toBe(undefined)
        expect(result['keep-alive']).toBe(undefined)
        expect(result['transfer-encoding']).toBe(undefined)
        expect(result['host']).toBe(undefined)
        expect(result['content-type']).toBe('text/html')
        expect(result['x-custom']).toBe('value')
    })

    it('removes pseudo-headers (starting with :)', () => {
        const input = {
            ':method': 'GET',
            ':path': '/foo',
            ':authority': 'example.com',
            'accept': '*/*',
        }
        const result = cleanHeadersForH2(input)
        expect(result[':method']).toBe(undefined)
        expect(result[':path']).toBe(undefined)
        expect(result['accept']).toBe('*/*')
    })

    it('lowercases all remaining header keys', () => {
        const result = cleanHeadersForH2({ 'Content-Type': 'text/html', 'X-Custom-Header': 'val' })
        expect('content-type' in result).toBeTruthy()
        expect('x-custom-header' in result).toBeTruthy()
        expect(result['Content-Type']).toBe(undefined)
    })

    it('returns empty object for empty input', () => {
        expect(cleanHeadersForH2({})).toEqual({})
    })

    it('removes proxy-related headers', () => {
        const input = {
            'proxy-authenticate': 'Basic',
            'proxy-authorization': 'Bearer token',
            'te': 'gzip',
            'trailer': 'Expires',
            'upgrade': 'h2c',
            'accept': 'text/html',
        }
        const result = cleanHeadersForH2(input)
        expect(result['proxy-authenticate']).toBe(undefined)
        expect(result['proxy-authorization']).toBe(undefined)
        expect(result['te']).toBe(undefined)
        expect(result['trailer']).toBe(undefined)
        expect(result['upgrade']).toBe(undefined)
        expect(result['accept']).toBe('text/html')
    })
})

describe('h2-pool makeProxyRequest', () => {
    it('is a function that accepts 4 arguments', () => {
        expect(typeof makeProxyRequest).toBe('function')
        expect(makeProxyRequest.length).toBe(4)
    })
})

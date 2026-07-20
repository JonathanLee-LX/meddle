const assert = require('assert')
const { normalizeShortResponse, sendShortResponse } = require('../dist/core/short-response')

describe('short-response normalizeShortResponse', () => {
    it('uses defaults when fields are missing', () => {
        const res = normalizeShortResponse(null)
        assert.strictEqual(res.statusCode, 200)
        assert.deepStrictEqual(res.headers, {})
        assert.strictEqual(res.body, '')
    })

    it('keeps provided values', () => {
        const res = normalizeShortResponse({ statusCode: 201, headers: { a: '1' }, body: 'ok' })
        assert.strictEqual(res.statusCode, 201)
        assert.strictEqual(res.headers.a, '1')
        assert.strictEqual(res.body, 'ok')
    })
})

describe('short-response sendShortResponse', () => {
    it('writes status, headers and body', () => {
        const calls = []
        const mockRes = {
            writeHead(code, headers) {
                calls.push(['writeHead', code, headers])
            },
            end(body) {
                calls.push(['end', body])
            },
        }
        sendShortResponse(mockRes, { statusCode: 202, headers: { 'x-a': '1' }, body: 'hello' })
        assert.strictEqual(calls[0][0], 'writeHead')
        assert.strictEqual(calls[0][1], 202)
        assert.strictEqual(calls[0][2]['x-a'], '1')
        assert.deepStrictEqual(calls[1], ['end', 'hello'])
    })
})

export {};

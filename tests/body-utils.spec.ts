import zlib from 'zlib'
import { describe, it, expect } from 'vitest'
import { safeBodyToString, safeBodyToDetail } from '../core/body-utils'

describe('body-utils safeBodyToString', () => {
    it('returns empty for empty buffer', () => {
        expect(safeBodyToString(Buffer.from(''), 100)).toBe('')
    })

    it('returns utf8 string for plain buffer', () => {
        expect(safeBodyToString(Buffer.from('hello'), 100)).toBe('hello')
    })

    it('decompresses gzip buffer', () => {
        const gz = zlib.gzipSync(Buffer.from('abc'))
        expect(safeBodyToString(gz, 100, 'gzip')).toBe('abc')
    })

    it('decompresses zstd buffer when supported', () => {
        const compress = (zlib as typeof zlib & {
            zstdCompressSync?: (buffer: Buffer) => Buffer
        }).zstdCompressSync
        if (!compress) return
        expect(safeBodyToString(compress(Buffer.from('zstd body')), 100, 'zstd')).toBe('zstd body')
    })

    it('does not decode unsupported compressed bytes as utf8', () => {
        expect(safeBodyToString(Buffer.from([0xff, 0xfe]), 100, 'compress'))
            .toBe('(compressed body: compress, 2 bytes)')
    })

    it('returns truncated marker when exceeds max', () => {
        const text = 'x'.repeat(20)
        const result = safeBodyToString(Buffer.from(text), 5)
        expect(result.startsWith('(truncated, 20 bytes)')).toBeTruthy()
    })
})

describe('body-utils safeBodyToDetail', () => {
    it('marks truncated bodies with structured flag', () => {
        const text = 'x'.repeat(20)
        const detail = safeBodyToDetail(Buffer.from(text), 5)
        expect(detail.truncated).toBe(true)
        expect(detail.originalBytes).toBe(20)
        expect(detail.text.startsWith('(truncated, 20 bytes)')).toBe(true)
    })

    it('marks non-truncated bodies as not truncated', () => {
        const detail = safeBodyToDetail(Buffer.from('hello'), 100)
        expect(detail.truncated).toBe(false)
        expect(detail.originalBytes).toBe(5)
        expect(detail.text).toBe('hello')
    })

    it('reports originalBytes for compressed undecodable bodies', () => {
        const detail = safeBodyToDetail(Buffer.from([0xff, 0xfe]), 100, 'compress')
        expect(detail.truncated).toBe(false)
        expect(detail.originalBytes).toBe(2)
        expect(detail.text).toBe('(compressed body: compress, 2 bytes)')
    })
})

import zlib from 'zlib'
import { describe, it, expect } from 'vitest'
import { safeBodyToString } from '../core/body-utils'

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

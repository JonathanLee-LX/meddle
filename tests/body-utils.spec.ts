import zlib from 'zlib'
import { randomBytes } from 'crypto'
import { describe, it, expect } from 'vitest'
import { safeBodyToString, safeBodyToDetail, safeBodyToDetailAsync, detailDecompressInputCap } from '../core/body-utils'

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

describe('body-utils safeBodyToDetailAsync', () => {
    it('decompresses gzip buffer asynchronously', async () => {
        const gz = zlib.gzipSync(Buffer.from('abc'))
        const detail = await safeBodyToDetailAsync(gz, 100, 'gzip')
        expect(detail.text).toBe('abc')
        expect(detail.truncated).toBe(false)
    })

    it('marks truncated bodies with structured flag', async () => {
        const text = 'x'.repeat(20)
        const detail = await safeBodyToDetailAsync(Buffer.from(text), 5)
        expect(detail.truncated).toBe(true)
        expect(detail.originalBytes).toBe(20)
    })

    it('refuses to decompress oversized compressed bodies (size cap)', async () => {
        // An incompressible (random-bytes) body whose gzip stream is itself
        // larger than the decompress input cap should not be decompressed; it
        // must be reported as "too large" instead so the event loop is never
        // blocked by a huge sync/async decompression.
        const cap = detailDecompressInputCap(256)
        const random = randomBytes(cap + 1)
        const huge = zlib.gzipSync(random)
        // gzip of random bytes is incompressible -> stays above the cap
        if (huge.length <= cap) return // skip if env compressed it under the cap
        const detail = await safeBodyToDetailAsync(huge, 256, 'gzip')
        expect(detail.truncated).toBe(false)
        expect(detail.text).toContain('too large to decompress')
        expect(detail.originalBytes).toBe(huge.length)
    })
})

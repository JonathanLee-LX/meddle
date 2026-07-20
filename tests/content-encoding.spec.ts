import * as zlib from 'zlib'
import { describe, expect, it } from 'vitest'
import { decompressContentEncoding } from '../core/content-encoding'

type ZlibWithZstd = typeof zlib & {
    zstdCompressSync?: (buffer: Buffer) => Buffer
}

describe('content encoding decompression', () => {
    it('decompresses gzip, deflate, and brotli', () => {
        const body = Buffer.from('hello compressed response')
        expect(decompressContentEncoding(zlib.gzipSync(body), 'gzip')).toEqual(body)
        expect(decompressContentEncoding(zlib.deflateSync(body), 'deflate')).toEqual(body)
        expect(decompressContentEncoding(zlib.brotliCompressSync(body), 'br')).toEqual(body)
    })

    it('decompresses zstd when supported by the Node runtime', () => {
        const compress = (zlib as ZlibWithZstd).zstdCompressSync
        if (!compress) return

        const body = Buffer.from('<html>zstd response</html>')
        expect(decompressContentEncoding(compress(body), 'zstd')).toEqual(body)
    })

    it('returns null for unsupported or invalid encodings', () => {
        expect(decompressContentEncoding(Buffer.from('body'), 'compress')).toBeNull()
        expect(decompressContentEncoding(Buffer.from('not gzip'), 'gzip')).toBeNull()
    })

    it('decodes stacked content encodings in reverse order', () => {
        const body = Buffer.from('stacked encoding')
        const encoded = zlib.brotliCompressSync(zlib.gzipSync(body))
        expect(decompressContentEncoding(encoded, 'gzip, br')).toEqual(body)
    })
})

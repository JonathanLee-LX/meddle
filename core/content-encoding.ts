import * as zlib from 'zlib'

type ZlibWithZstd = typeof zlib & {
    zstdDecompressSync?: (buffer: Buffer) => Buffer
}

function decompressSingleEncoding(content: Buffer, encoding: string): Buffer | null {
    try {
        switch (encoding) {
            case '':
            case 'identity':
                return content
            case 'gzip':
            case 'x-gzip':
                return zlib.gunzipSync(content)
            case 'deflate':
                return zlib.inflateSync(content)
            case 'br':
                return zlib.brotliDecompressSync(content)
            case 'zstd': {
                const decompress = (zlib as ZlibWithZstd).zstdDecompressSync
                return decompress ? decompress(content) : null
            }
            default:
                return null
        }
    } catch (_) {
        return null
    }
}

export function decompressContentEncoding(
    buffer: Buffer,
    contentEncoding?: string,
): Buffer | null {
    const encodings = (contentEncoding || '')
        .split(',')
        .map(encoding => encoding.trim().toLowerCase())
        .filter(Boolean)

    let content = buffer
    for (const encoding of encodings.reverse()) {
        const decompressed = decompressSingleEncoding(content, encoding)
        if (!decompressed) return null
        content = decompressed
    }
    return content
}

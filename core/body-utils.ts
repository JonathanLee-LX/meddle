import { promisify } from 'util'
import * as zlib from 'zlib'
import { decompressContentEncoding } from './content-encoding';

const gunzipAsync = promisify(zlib.gunzip)
const inflateAsync = promisify(zlib.inflate)
const brotliDecompressAsync = promisify(zlib.brotliDecompress)
const zstdDecompressAsync = (zlib as typeof zlib & {
    zstdDecompress?: (buffer: Buffer, callback: (err: Error | null, result: Buffer) => void) => void
}).zstdDecompress
const zstdAsync = zstdDecompressAsync ? promisify(zstdDecompressAsync) : null

// Upper bound on compressed input we are willing to decompress for a detail.
// Since we only keep `max` bytes of the decompressed body, decompressing vastly
// larger inputs is pure waste (CPU + memory) and, when done synchronously, can
// block the event loop for minutes on huge payloads. Bodies larger than this
// are reported as a placeholder instead of being decompressed.
export function detailDecompressInputCap(max: number): number {
    return Math.max(max * 8, 2 * 1024 * 1024)
}

async function decompressContentEncodingAsync(
    buffer: Buffer,
    contentEncoding: string | undefined,
    maxInputBytes: number,
): Promise<Buffer | null> {
    const encodings = (contentEncoding || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)

    if (encodings.length === 0) return buffer
    // Refuse to decompress oversized inputs: we'd only keep `max` bytes anyway.
    if (buffer.length > maxInputBytes) return null

    let content = buffer
    for (const encoding of encodings.reverse()) {
        try {
            switch (encoding) {
                case 'identity':
                case '':
                    break
                case 'gzip':
                case 'x-gzip':
                    content = await gunzipAsync(content); break
                case 'deflate':
                    content = await inflateAsync(content); break
                case 'br':
                    content = await brotliDecompressAsync(content); break
                case 'zstd':
                    if (!zstdAsync) return null
                    content = await zstdAsync(content); break
                default:
                    return null
            }
        } catch (_) {
            return null
        }
    }
    return content
}

export interface BodyDetail {
    text: string;
    truncated: boolean;
    originalBytes: number;
}

// Sync variant for paths that never receive compressed upstream bodies (mock
// responses, map-local file serving). When an encoding is present it falls back
// to the (bounded) sync decompressor; callers without encoding pass nothing and
// this is effectively a no-op.
export function safeBodyToDetail(
    buf: Buffer | any,
    max: number,
    encoding?: string
): BodyDetail {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return { text: '', truncated: false, originalBytes: 0 };
    }

    const content = decompressContentEncoding(buf, encoding);
    if (!content) {
        return {
            text: `(compressed body: ${encoding || 'unknown'}, ${buf.length} bytes)`,
            truncated: false,
            originalBytes: buf.length,
        };
    }

    if (content.length > max) {
        return {
            text: `(truncated, ${content.length} bytes)\n` + content.slice(0, max).toString('utf8'),
            truncated: true,
            originalBytes: content.length,
        };
    }

    try {
        return { text: content.toString('utf8'), truncated: false, originalBytes: content.length };
    } catch (_) {
        return { text: '(binary)', truncated: false, originalBytes: content.length };
    }
}

// Async variant for the proxy hot path: decompresses off the event loop
// (libuv thread pool) and refuses oversized inputs. This prevents large
// compressed upstream responses from starving the event loop (watchdog
// eventLoopDelay critical).
export async function safeBodyToDetailAsync(
    buf: Buffer | any,
    max: number,
    encoding?: string
): Promise<BodyDetail> {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return { text: '', truncated: false, originalBytes: 0 };
    }

    const cap = detailDecompressInputCap(max)
    const content = await decompressContentEncodingAsync(buf, encoding, cap);
    if (!content) {
        // Either a genuinely unsupported encoding or an oversized input we
        // refused to decompress. Distinguish so the detail is informative.
        if (encoding && buf.length > cap) {
            return {
                text: `(compressed body too large to decompress: ${encoding}, ${buf.length} bytes)`,
                truncated: false,
                originalBytes: buf.length,
            }
        }
        return {
            text: `(compressed body: ${encoding || 'unknown'}, ${buf.length} bytes)`,
            truncated: false,
            originalBytes: buf.length,
        };
    }

    if (content.length > max) {
        return {
            text: `(truncated, ${content.length} bytes)\n` + content.slice(0, max).toString('utf8'),
            truncated: true,
            originalBytes: content.length,
        };
    }

    try {
        return { text: content.toString('utf8'), truncated: false, originalBytes: content.length };
    } catch (_) {
        return { text: '(binary)', truncated: false, originalBytes: content.length };
    }
}

export function safeBodyToString(
    buf: Buffer | any,
    max: number,
    encoding?: string
): string {
    return safeBodyToDetail(buf, max, encoding).text;
}
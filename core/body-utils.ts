import { decompressContentEncoding } from './content-encoding';

export interface BodyDetail {
    text: string;
    truncated: boolean;
    originalBytes: number;
}

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

export function safeBodyToString(
    buf: Buffer | any,
    max: number,
    encoding?: string
): string {
    return safeBodyToDetail(buf, max, encoding).text;
}
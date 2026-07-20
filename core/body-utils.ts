import { decompressContentEncoding } from './content-encoding';

export function safeBodyToString(
    buf: Buffer | any, 
    max: number, 
    encoding?: string
): string {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return '';
    
    const content = decompressContentEncoding(buf, encoding);
    if (!content) return `(compressed body: ${encoding || 'unknown'}, ${buf.length} bytes)`;
    
    if (content.length > max) {
        return `(truncated, ${content.length} bytes)\n` + content.slice(0, max).toString('utf8');
    }
    
    try {
        return content.toString('utf8');
    } catch (_) {
        return '(binary)';
    }
}

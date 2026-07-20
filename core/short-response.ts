import { Response } from './types';
import * as http from 'http';

export function normalizeShortResponse(response?: Partial<Response> | null): Response {
    const res = response || {};
    return {
        statusCode: res.statusCode || 200,
        headers: res.headers || {},
        body: res.body || '',
    };
}

export function sendShortResponse(
    res: http.ServerResponse, 
    response: Partial<Response> | null
): void {
    const normalized = normalizeShortResponse(response);
    res.writeHead(normalized.statusCode, normalized.headers);
    res.end(normalized.body);
}

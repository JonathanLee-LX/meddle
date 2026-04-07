import * as fs from 'fs'
import * as path from 'path'
import type { ProxyContext } from './types'
import { appendProxyRecord } from './proxy-record'
import { testRulePattern } from '../helpers'

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.json': 'application/json', '.xml': 'application/xml',
    '.txt': 'text/plain', '.md': 'text/markdown',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.wasm': 'application/wasm', '.swf': 'application/x-shockwave-flash',
}

export function getMimeType(filePath: string): string {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

export function handleMapLocalRequest(ctx: ProxyContext, req: any, res: any, source: string, fileUrl: string): void {
    let filePath = fileUrl.replace(/^file:\/\//, '')
    if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.substring(1)
    filePath = decodeURIComponent(filePath)

    const startTime = Date.now()
    const recordId = ctx.recordIdSeq++

    req.on('error', () => { /* drain */ })
    req.resume()

    function makeLogData(statusCode: number, duration: number) {
        // 查找匹配的路由规则
        const matchedRule = Object.keys(ctx.ruleMap).find(pattern => testRulePattern(pattern, source))
        const matchedTarget = matchedRule ? ctx.ruleMap[matchedRule] : null
        return {
            id: recordId, method: req.method as string, source, target: fileUrl,
            time: new Date().toLocaleTimeString(), mapLocal: true, statusCode, duration,
            matchedRule: matchedRule || undefined,
            matchedTarget: matchedTarget || undefined,
        }
    }

    if (!fs.existsSync(filePath)) {
        const duration = Date.now() - startTime
        const body = 'File not found: ' + filePath
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(body)
        appendProxyRecord(ctx, makeLogData(404, duration), {
            requestHeaders: req.headers || {}, requestBody: '',
            responseHeaders: { 'Content-Type': 'text/plain; charset=utf-8' },
            responseBody: body, statusCode: 404, statusMessage: 'Not Found', method: req.method, url: source,
            inspection: {
                url: source,
                method: req.method as string,
                stages: [
                    {
                        name: 'builtin.router',
                        type: 'builtin',
                        hook: 'onBeforeProxy',
                        status: 'ok',
                        duration: 0,
                        target: fileUrl,
                        shortCircuited: true,
                        changes: { target: fileUrl },
                    },
                ],
                totalDuration: duration,
            },
        })
        return
    }

    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
        const duration = Date.now() - startTime
        const body = 'Is a directory: ' + filePath
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(body)
        appendProxyRecord(ctx, makeLogData(403, duration))
        return
    }

    try {
        const fileContent = fs.readFileSync(filePath)
        const mimeType = getMimeType(filePath)
        const duration = Date.now() - startTime
        const headers: Record<string, any> = {
            'Content-Type': mimeType, 'Content-Length': fileContent.length,
            'Access-Control-Allow-Origin': '*'
        }
        if (mimeType.startsWith('image/') || mimeType.startsWith('font/')) {
            headers['Cache-Control'] = 'public, max-age=31536000'
        }
        res.writeHead(200, headers)
        res.end(fileContent)
        appendProxyRecord(ctx, makeLogData(200, duration), {
            requestHeaders: req.headers || {}, requestBody: '',
            responseHeaders: headers,
            responseBody: mimeType.startsWith('text/') || mimeType === 'application/json'
                ? fileContent.toString('utf8') : `(binary, ${fileContent.length} bytes)`,
            statusCode: 200, statusMessage: 'OK', method: req.method, url: source,
            inspection: {
                url: source,
                method: req.method as string,
                stages: [
                    {
                        name: 'builtin.router',
                        type: 'builtin',
                        hook: 'onBeforeProxy',
                        status: 'ok',
                        duration: 0,
                        target: fileUrl,
                        shortCircuited: true,
                        changes: {
                            target: fileUrl,
                        },
                    },
                ],
                totalDuration: duration,
            },
        })
    } catch (err: any) {
        const duration = Date.now() - startTime
        const body = 'Error reading file: ' + err.message
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(body)
        appendProxyRecord(ctx, makeLogData(500, duration), {
            requestHeaders: req.headers || {}, requestBody: '',
            responseHeaders: { 'Content-Type': 'text/plain; charset=utf-8' },
            responseBody: body, statusCode: 500, statusMessage: 'Internal Server Error', method: req.method, url: source,
            inspection: {
                url: source,
                method: req.method as string,
                stages: [
                    {
                        name: 'builtin.router',
                        type: 'builtin',
                        hook: 'onBeforeProxy',
                        status: 'error',
                        duration: 0,
                        target: fileUrl,
                        error: err.message,
                    },
                ],
                totalDuration: duration,
            },
        })
    }
}

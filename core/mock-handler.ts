import * as fs from 'fs'
import * as path from 'path'
import _debug from 'debug'
import { getMimeType } from './map-local'
import { appendProxyRecord } from './proxy-record'
import type { ProxyContext, MockHandler, MockRuleEntry } from './types'

const proxyDebug = _debug('proxy')

/** 按 id 去重，后出现的条目覆盖先前的（与前端 use-mocks 行为一致） */
export function dedupeMockRulesById(rules: MockRuleEntry[]): MockRuleEntry[] {
    const byId = new Map<number, MockRuleEntry>()
    for (const rule of rules) {
        if (rule.id != null) {
            byId.set(rule.id, rule)
        }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id)
}

export function createMockHandler(ctx: ProxyContext): MockHandler {
    const DEFAULT_MOCK_FILE = path.join(ctx.epDir, 'mocks.json')

    function loadCustomPathsFromSettings(): { mocksFilePath: string | null } {
        try {
            if (fs.existsSync(ctx.settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
                return { mocksFilePath: settings.mocksFilePath || null }
            }
        } catch (error) {
            console.error('加载自定义配置路径失败:', error)
        }
        return { mocksFilePath: null }
    }

    function getMockFilePath(): string {
        if (ctx.currentMocksPath) return ctx.currentMocksPath
        const customPaths = loadCustomPathsFromSettings()
        if (customPaths.mocksFilePath && fs.existsSync(customPaths.mocksFilePath)) {
            ctx.currentMocksPath = customPaths.mocksFilePath
            return ctx.currentMocksPath
        }
        ctx.currentMocksPath = DEFAULT_MOCK_FILE
        return DEFAULT_MOCK_FILE
    }

    function loadMockRules(): void {
        try {
            const mockFile = getMockFilePath()
            if (fs.existsSync(mockFile)) {
                const data = JSON.parse(fs.readFileSync(mockFile, 'utf8'))
                const loaded = Array.isArray(data.rules) ? data.rules : []
                ctx.mockRules = dedupeMockRulesById(loaded)
                if (loaded.length !== ctx.mockRules.length) {
                    proxyDebug(`Mock 规则去重: ${loaded.length} -> ${ctx.mockRules.length}`)
                }
                ctx.mockIdSeq = (data.nextId || Math.max(0, ...ctx.mockRules.map(r => r.id || 0))) + 1
                proxyDebug(`已加载 ${ctx.mockRules.length} 条 Mock 规则 (${mockFile})`)
            }
        } catch (err: any) {
            console.error('加载 mock 规则失败:', err.message)
            ctx.mockRules = []
        }
    }

    function saveMockRules(): void {
        try {
            ctx.mockRules = dedupeMockRulesById(ctx.mockRules)
            const mockFile = getMockFilePath()
            fs.writeFileSync(mockFile, JSON.stringify({ nextId: ctx.mockIdSeq, rules: ctx.mockRules }, null, 2), 'utf8')
            proxyDebug(`Mock 规则已保存到 ${mockFile}`)
        } catch (err: any) {
            console.error('保存 mock 规则失败:', err.message)
        }
    }

    function matchMockRule(url: string, method: string): MockRuleEntry | null {
        return ctx.mockRules.find(rule => {
            if (!rule.enabled) return false
            if (rule.method && rule.method !== '*' && rule.method.toUpperCase() !== method.toUpperCase()) return false
            try { return new RegExp(rule.urlPattern).test(url) } catch { return url.includes(rule.urlPattern) }
        }) || null
    }

    function buildMockResponseForTest(rule: MockRuleEntry): { statusCode: number; headers: Record<string, string>; body: string } {
        const statusCode = rule.statusCode || 200
        const ruleHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(rule.headers || {})) {
            ruleHeaders[key.toLowerCase()] = value
        }
        const headers: Record<string, string> = {
            'x-mock-rule': encodeURIComponent(rule.name || rule.id?.toString() || rule.urlPattern || ''),
            'content-type': ruleHeaders['content-type'] || 'application/json',
            ...ruleHeaders,
        }
        let body = ''
        if (rule.bodyType === 'file' && rule.body) {
            let filePath = rule.body.replace(/^file:\/\//, '').replace(/^\/[A-Za-z]:\//, '')
            filePath = decodeURIComponent(filePath)
            try {
                if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
                    body = fs.readFileSync(filePath, 'utf8')
                }
            } catch (_) { body = '(mock file read error)' }
        } else {
            body = rule.body || ''
            if (body.match(/^data:([^;]+);base64,/)) body = '(base64 mock body)'
        }
        return { statusCode, headers, body }
    }

    function sendMockResponse(req: any, res: any, rule: MockRuleEntry, logInfo: { method: string; source: string; target: string }): void {
        const statusCode = rule.statusCode || 200
        const delay = rule.delay || 0
        const startTime = Date.now()
        const mockRuleName = rule.name || rule.id.toString()
        const isFileBody = rule.bodyType === 'file' && rule.body

        req.on('error', () => { /* drain */ })
        req.resume()

        const doSend = (): void => {
            const duration = Date.now() - startTime
            let responseBody = ''
            const ruleHeaders: Record<string, string> = {}
            for (const [key, value] of Object.entries(rule.headers || {})) {
                ruleHeaders[key.toLowerCase()] = value
            }
            const responseHeaders: Record<string, any> = {
                'X-Mock-Rule': encodeURIComponent(mockRuleName),
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Headers': '*',
                ...ruleHeaders
            }
            let finalStatusCode = statusCode
            let statusMessage = 'OK (Mock)'

            if (isFileBody) {
                let filePath = rule.body
                if (filePath.startsWith('file://')) filePath = filePath.replace(/^file:\/\//, '')
                if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.substring(1)
                filePath = decodeURIComponent(filePath)

                if (!fs.existsSync(filePath)) {
                    finalStatusCode = 404; statusMessage = 'Not Found (Mock File)'
                    responseHeaders['Content-Type'] = 'text/plain; charset=utf-8'
                    responseBody = 'Mock file not found: ' + filePath
                } else {
                    const stat = fs.statSync(filePath)
                    if (stat.isDirectory()) {
                        finalStatusCode = 403; statusMessage = 'Forbidden (Mock File)'
                        responseHeaders['Content-Type'] = 'text/plain; charset=utf-8'
                        responseBody = 'Is a directory: ' + filePath
                    } else {
                        try {
                            const fileContent = fs.readFileSync(filePath)
                            const mimeType = getMimeType(filePath)
                            responseHeaders['Content-Type'] = mimeType
                            responseHeaders['Content-Length'] = fileContent.length
                            try { res.writeHead(finalStatusCode, responseHeaders); res.end(fileContent) }
                            catch (err: any) {
                                console.error('Mock 文件响应发送失败:', err.message)
                                try { if (!res.headersSent) { res.writeHead(finalStatusCode); res.end(fileContent) } } catch (_) { /* ignore */ }
                            }
                            responseBody = mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/javascript' || mimeType === 'application/xml'
                                ? fileContent.toString('utf8').substring(0, ctx.MAX_BODY_SIZE)
                                : `(binary, ${fileContent.length} bytes)`
                            logMockRecord()
                            return
                        } catch (err: any) {
                            finalStatusCode = 500; statusMessage = 'Error (Mock File)'
                            responseHeaders['Content-Type'] = 'text/plain; charset=utf-8'
                            responseBody = 'Error reading file: ' + err.message
                        }
                    }
                }
            } else {
                const bodyContent = rule.body || ''
                const base64Match = bodyContent.match(/^data:([^;]+);base64,(.+)$/)
                if (base64Match) {
                    const mimeType = base64Match[1]
                    const base64Data = base64Match[2]
                    const buffer = Buffer.from(base64Data, 'base64')
                    responseHeaders['Content-Type'] = mimeType
                    responseHeaders['Content-Length'] = buffer.length
                    try { res.writeHead(finalStatusCode, responseHeaders); res.end(buffer) }
                    catch (err: any) {
                        console.error('Mock Base64 响应发送失败:', err.message)
                        try { if (!res.headersSent) { res.writeHead(finalStatusCode); res.end(buffer) } } catch (_) { /* ignore */ }
                    }
                    logMockRecord()
                    return
                }
                responseHeaders['Content-Type'] = responseHeaders['content-type'] || 'application/json'
                responseBody = bodyContent
            }

            try { res.writeHead(finalStatusCode, responseHeaders); res.end(responseBody) }
            catch (err: any) {
                console.error('Mock 响应发送失败:', err.message)
                try { if (!res.headersSent) { res.writeHead(finalStatusCode); res.end(responseBody) } } catch (_) { /* ignore */ }
            }
            logMockRecord()

            function logMockRecord(): void {
                const recordId = ctx.recordIdSeq++
                const logData = {
                    id: recordId, method: logInfo.method, source: logInfo.source,
                    target: `[MOCK: ${rule.name || rule.urlPattern}]`,
                    time: new Date().toLocaleTimeString(), mock: true as const,
                    statusCode: finalStatusCode, duration,
                    mockRuleId: rule.id,
                    mockRuleName: rule.name,
                }
                const detail: ProxyContext['proxyRecordDetailMap'] extends Map<number, infer T> ? T : never = {
                    requestHeaders: req.headers || {}, requestBody: '',
                    responseHeaders, responseBody, statusCode: finalStatusCode,
                    statusMessage, method: logInfo.method, url: logInfo.source,
                    // 添加 mock 相关的 inspection 信息
                    inspection: {
                        url: logInfo.source,
                        method: logInfo.method,
                        stages: [
                            {
                                name: 'builtin.mock',
                                type: 'builtin',
                                hook: 'onBeforeProxy',
                                status: 'short-circuited',
                                duration: 0,
                                shortCircuited: true,
                                changes: {
                                    responseStatusCode: finalStatusCode,
                                    responseStatusCodeAfter: finalStatusCode,
                                    responseHeadersBefore: {},
                                    responseHeaders,
                                    responseHeadersAfter: responseHeaders,
                                    responseBodyBefore: '',
                                    responseBody: typeof responseBody === 'string' ? responseBody : '',
                                    responseBodyAfter: typeof responseBody === 'string' ? responseBody : '',
                                },
                            },
                        ],
                        totalDuration: duration,
                    },
                }
                appendProxyRecord(ctx, logData, detail)
            }
        }

        if (delay > 0) { setTimeout(doSend, delay) } else { doSend() }
    }

    return {
        getMockFilePath, loadMockRules, saveMockRules, matchMockRule,
        buildMockResponseForTest, sendMockResponse, loadCustomPathsFromSettings,
    }
}

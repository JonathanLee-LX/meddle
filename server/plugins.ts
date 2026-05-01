import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { ServerContext } from './index'
import { isPathSafe } from './security-middleware'

type TestPlugin = {
    manifest: {
        id: string
        name: string
        hooks?: string[]
        priority?: number
    }
    [key: string]: unknown
}

export function sortPluginsByHookOrder(plugins: TestPlugin[]): TestPlugin[] {
    return [...plugins].sort((a, b) => {
        const priorityA = typeof a.manifest.priority === 'number' ? a.manifest.priority : 100
        const priorityB = typeof b.manifest.priority === 'number' ? b.manifest.priority : 100
        if (priorityA !== priorityB) return priorityA - priorityB
        return a.manifest.id.localeCompare(b.manifest.id)
    })
}

export function selectTestPluginsForHook(
    allPlugins: TestPlugin[],
    hookName: string,
    targetPluginId: string,
    includeBuiltinFlow: boolean,
): TestPlugin[] {
    const allowedIds = new Set<string>([targetPluginId])
    if (includeBuiltinFlow) {
        allowedIds.add('builtin.mock')
        allowedIds.add('builtin.router')
    }

    return sortPluginsByHookOrder(
        allPlugins.filter((plugin) =>
            allowedIds.has(plugin.manifest.id) &&
            Array.isArray(plugin.manifest.hooks) &&
            plugin.manifest.hooks.includes(hookName),
        ),
    )
}

export function registerPluginsRoutes(app: Application, ctx: ServerContext): void {
    const epDir = ctx.epDir

    // API: 生成插件代码（流式）
    app.post('/api/plugins/generate-stream', async (req: Request, res: Response) => {
        try {
            const data = req.body
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { generatePluginStream, cleanAIResponse } = require('../core/plugin-generator')

            // 设置 SSE 响应头 - CORS 已由 security-middleware 处理
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            })

            // 发送初始事件
            res.write('event: start\n')
            res.write('data: {"status":"generating"}\n\n')

            let accumulatedCode = ''

            // 生成插件，实时发送chunk
            const result = await generatePluginStream(
                data.requirement,
                data.aiConfig,
                (chunk: string) => {
                    accumulatedCode += chunk
                    res.write('event: chunk\n')
                    res.write(`data: ${JSON.stringify({ chunk, accumulated: cleanAIResponse(accumulatedCode) })}\n\n`)
                }
            )

            // 发送完成事件
            res.write('event: complete\n')
            res.write(`data: ${JSON.stringify({ status: 'success', plugin: result })}\n\n`)
            res.end()
        } catch (error) {
            res.write('event: error\n')
            res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`)
            res.end()
        }
    })

    // API: 生成插件代码（非流式，向后兼容）
    app.post('/api/plugins/generate', async (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const data = req.body
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { generatePlugin } = require('../core/plugin-generator')
            const result = await generatePlugin(data.requirement, data.aiConfig)
            res.write(JSON.stringify({ status: 'success', plugin: result }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: 保存插件到配置目录
    app.post('/api/plugins/save', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const data = req.body
            const pluginsDir = path.resolve(epDir, 'plugins')

            // 创建 plugins 目录
            if (!fs.existsSync(pluginsDir)) {
                fs.mkdirSync(pluginsDir, { recursive: true })
            }

            // 安全检查：验证文件名
            const filename = data.filename
            if (!filename || typeof filename !== 'string') {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '缺少 filename 参数' }))
                res.end()
                return
            }

            // 检查文件名是否安全（不允许路径遍历）
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('~')) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '非法的文件名' }))
                res.end()
                return
            }

            // 只允许 .js 文件
            if (!filename.endsWith('.js')) {
                res.statusCode = 400
                res.write(JSON.stringify({ error: '只允许保存 .js 文件' }))
                res.end()
                return
            }

            const filePath = path.resolve(pluginsDir, filename)

            // 再次验证最终路径是否在 plugins 目录内
            if (!isPathSafe(filePath, pluginsDir)) {
                res.statusCode = 403
                res.write(JSON.stringify({ error: '非法的文件路径' }))
                res.end()
                return
            }

            fs.writeFileSync(filePath, data.code, 'utf8')

            console.log(`已保存插件: ${data.filename}`)

            res.write(JSON.stringify({
                status: 'success',
                message: '插件已保存',
                path: filePath
            }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: 列出自定义插件
    app.get('/api/plugins/custom', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const pluginsDir = path.resolve(epDir, 'plugins')

            if (!fs.existsSync(pluginsDir)) {
                res.write(JSON.stringify({ plugins: [] }))
                res.end()
                return
            }

            const files = fs.readdirSync(pluginsDir)
            const pluginInfo: Array<{ filename: string; path: string; modified: Date }> = []

            // 只列出.js文件
            const jsFiles = files.filter(f => f.endsWith('.js'))

            jsFiles.forEach(jsFile => {
                const jsPath = path.resolve(pluginsDir, jsFile)
                const jsStat = fs.statSync(jsPath)

                pluginInfo.push({
                    filename: jsFile,
                    path: jsPath,
                    modified: jsStat.mtime
                })
            })

            res.write(JSON.stringify({ plugins: pluginInfo }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: 读取插件源码
    app.get('/api/plugins/custom/:filename/code', (req: Request, res: Response) => {
        try {
            const filename = decodeURIComponent(req.params.filename as string)
            const pluginsDir = path.resolve(epDir, 'plugins')
            const filePath = path.resolve(pluginsDir, filename)

            // 安全检查
            if (!isPathSafe(filePath, pluginsDir)) {
                res.status(403).json({ error: '非法的文件路径' })
                return
            }

            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: '插件文件不存在' })
                return
            }

            const code = fs.readFileSync(filePath, 'utf8')
            res.json({ filename, code })
        } catch (error) {
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // API: 更新插件源码
    app.put('/api/plugins/custom/:filename/code', (req: Request, res: Response) => {
        try {
            const filename = decodeURIComponent(req.params.filename as string)
            const pluginsDir = path.resolve(epDir, 'plugins')
            const filePath = path.resolve(pluginsDir, filename)

            // 安全检查
            if (!isPathSafe(filePath, pluginsDir)) {
                res.status(403).json({ error: '非法的文件路径' })
                return
            }

            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: '插件文件不存在' })
                return
            }

            const { code } = req.body
            if (typeof code !== 'string') {
                res.status(400).json({ error: '缺少 code 字段' })
                return
            }

            fs.writeFileSync(filePath, code, 'utf8')
            console.log(`已更新插件代码: ${filename}`)
            res.json({ status: 'success', message: '插件代码已保存' })
        } catch (error) {
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // API: 删除自定义插件
    app.delete('/api/plugins/custom/:filename', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const filename = decodeURIComponent(req.params.filename as string)
            const pluginsDir = path.resolve(epDir, 'plugins')
            const filePath = path.resolve(pluginsDir, filename)

            // 安全检查：确保文件在 plugins 目录内
            if (!isPathSafe(filePath, pluginsDir)) {
                res.statusCode = 403
                res.write(JSON.stringify({ error: '非法的文件路径' }))
                res.end()
                return
            }

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)

                // 同时删除编译后的.js文件
                if (filename.endsWith('.ts')) {
                    const jsPath = filePath.replace(/\.ts$/, '.js')
                    if (fs.existsSync(jsPath)) {
                        fs.unlinkSync(jsPath)
                    }
                }

                res.write(JSON.stringify({
                    status: 'success',
                    message: '插件已删除'
                }))
            } else {
                res.statusCode = 404
                res.write(JSON.stringify({ error: '插件文件不存在' }))
            }
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: 热加载自定义插件
    app.post('/api/plugins/reload', async (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const plugins = await ctx.reloadCustomPlugins()
            res.write(JSON.stringify({
                status: 'success',
                message: `已重新加载 ${plugins.length} 个自定义插件`,
                count: plugins.length,
                plugins: plugins.map((p: unknown) => {
                    const plugin = p as { manifest: { id: string; name: string; version: string } }
                    return {
                        id: plugin.manifest.id,
                        name: plugin.manifest.name,
                        version: plugin.manifest.version
                    }
                })
            }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: AI自动修复插件
    app.post('/api/plugins/fix', async (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const data = req.body
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { fixPluginWithAI } = require('../core/plugin-generator')
            const fixedCode = await fixPluginWithAI(
                data.originalCode,
                data.testError,
                data.requirement,
                data.aiConfig
            )
            res.write(JSON.stringify({ status: 'success', fixedCode }))
        } catch (error) {
            res.statusCode = 500
            res.write(JSON.stringify({ error: (error as Error).message }))
        }
        res.end()
    })

    // API: AI自动修复插件（流式）
    app.post('/api/plugins/fix-stream', async (req: Request, res: Response) => {
        try {
            const data = req.body
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { fixPluginWithAIStream, cleanAIResponse } = require('../core/plugin-generator')

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            })

            res.write('event: start\n')
            res.write('data: {"status":"generating"}\n\n')

            let accumulatedCode = ''
            const fixedCode = await fixPluginWithAIStream(
                data.originalCode,
                data.testError,
                data.requirement,
                data.aiConfig,
                (chunk: string) => {
                    accumulatedCode += chunk
                    res.write('event: chunk\n')
                    res.write(`data: ${JSON.stringify({ chunk, accumulated: cleanAIResponse(accumulatedCode) })}\n\n`)
                }
            )

            res.write('event: complete\n')
            res.write(`data: ${JSON.stringify({ status: 'success', fixedCode })}\n\n`)
            res.end()
        } catch (error) {
            res.write('event: error\n')
            res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`)
            res.end()
        }
    })

    app.post('/api/plugins/revise-stream', async (req: Request, res: Response) => {
        try {
            const data = req.body
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { revisePluginWithAIStream, cleanAIResponse } = require('../core/plugin-generator')

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            })

            res.write('event: start\n')
            res.write('data: {"status":"generating"}\n\n')

            let accumulatedCode = ''
            const revisedCode = await revisePluginWithAIStream(
                data.originalCode,
                data.instruction,
                data.requirement,
                data.aiConfig,
                (chunk: string) => {
                    accumulatedCode += chunk
                    res.write('event: chunk\n')
                    res.write(`data: ${JSON.stringify({ chunk, accumulated: cleanAIResponse(accumulatedCode) })}\n\n`)
                }
            )

            res.write('event: complete\n')
            res.write(`data: ${JSON.stringify({ status: 'success', revisedCode })}\n\n`)
            res.end()
        } catch (error) {
            res.write('event: error\n')
            res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`)
            res.end()
        }
    })

    // API: 测试插件功能（真实请求模式）
    app.post('/api/plugins/test', async (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        try {
            const data = req.body
            const pluginId = data.pluginId
            const url = data.url || 'http://example.com/test'
            const method = (data.method || 'GET').toUpperCase()
            const integrated = data.integrated !== false

            const allPlugins = ctx.pluginManager.getAll() as TestPlugin[]
            const targetPlugin = allPlugins.find(p => p.manifest.id === pluginId)

            if (!targetPlugin) {
                res.status(404).json({ error: '插件不存在' })
                return
            }

            const testLogs: Array<{ level: string; message: string; timestamp: number }> = []
            const testLogger = {
                debug: (...args: unknown[]) => testLogs.push({ level: 'debug', message: args.join(' '), timestamp: Date.now() }),
                log: (...args: unknown[]) => testLogs.push({ level: 'log', message: args.join(' '), timestamp: Date.now() }),
                info: (...args: unknown[]) => testLogs.push({ level: 'info', message: args.join(' '), timestamp: Date.now() }),
                warn: (...args: unknown[]) => testLogs.push({ level: 'warn', message: args.join(' '), timestamp: Date.now() }),
                error: (...args: unknown[]) => testLogs.push({ level: 'error', message: args.join(' '), timestamp: Date.now() }),
            }

            const hooks = targetPlugin.manifest.hooks || []
            const hookResults: Record<string, unknown> = {}

            // integrated=true：尽量贴近真实代理前半段（直出 Mock / 内置 Mock / Router 的先后）
            const source = url
            const legacyTarget = integrated && typeof ctx.resolveTargetUrlForTest === 'function'
                ? ctx.resolveTargetUrlForTest(source)
                : source
            const usePipelineFlow = integrated && typeof ctx.canUsePipelineExecuteForTest === 'function'
                ? ctx.canUsePipelineExecuteForTest(source)
                : false
            let currentTarget = usePipelineFlow ? source : legacyTarget

            const requestMutable = {
                method,
                url: source,
                headers: { 'user-agent': 'easy-proxy-test/1.0', ...(data.headers || {}) } as Record<string, string>,
                body: data.body || '',
            }
            const initialRequestSnapshot = { headers: { ...requestMutable.headers }, body: requestMutable.body }
            let shortCircuited = false
            let shortCircuitResponse: Record<string, unknown> | null = null
            let realResponse: { statusCode: number; headers: Record<string, string>; body: string } | null = null
            let fetchError: string | null = null
            let fetchDuration = 0
            let usedMock = false
            const requestMeta: Record<string, unknown> = { _test: true, _pluginRequestStartAt: Date.now() }

            // --- Phase 0: 与真实代理一致，先处理“直出 Mock”路径 ---
            if (integrated) {
                const mockRule = typeof ctx.matchMockRuleForTest === 'function'
                    ? ctx.matchMockRuleForTest(source, method)
                    : null
                if (mockRule && typeof ctx.shouldUseMockForTest === 'function' && ctx.shouldUseMockForTest(source, mockRule) && typeof ctx.buildMockResponseForTest === 'function') {
                    const mockRes = ctx.buildMockResponseForTest(mockRule)
                    currentTarget = source
                    realResponse = { statusCode: mockRes.statusCode, headers: mockRes.headers, body: mockRes.body }
                    fetchDuration = 0
                    usedMock = true
                }
            }

            // --- Phase 1: onRequestStart / onBeforeProxy ---
            if (!realResponse) {
                for (const hookName of ['onRequestStart', 'onBeforeProxy']) {
                    const orderedPlugins = selectTestPluginsForHook(allPlugins, hookName, pluginId, integrated && usePipelineFlow)
                    if (orderedPlugins.length === 0) continue

                    const hookStartTarget = currentTarget
                    const hookCtx: Record<string, unknown> = {
                        log: testLogger,
                        request: requestMutable,
                        target: currentTarget,
                        meta: requestMeta,
                        shortCircuited,
                        shortCircuitResponse,
                        setTarget: (t: string) => { hookCtx.target = t; currentTarget = t },
                        respond: (r: unknown) => {
                            hookCtx.shortCircuited = true
                            hookCtx.shortCircuitResponse = r
                            shortCircuited = true
                            shortCircuitResponse = r as Record<string, unknown>
                        },
                    }

                    for (const plugin of orderedPlugins) {
                        const hookFn = plugin[hookName]
                        if (typeof hookFn !== 'function') continue

                        const t0 = Date.now()
                        try {
                            await (hookFn as (c: unknown) => Promise<void>).call(plugin, hookCtx)
                            if (plugin.manifest.id === pluginId) {
                                hookResults[hookName] = {
                                    status: 'success',
                                    duration: Date.now() - t0,
                                    targetChanged: currentTarget !== hookStartTarget ? currentTarget : null,
                                    shortCircuited,
                                }
                            }
                        } catch (e) {
                            if (plugin.manifest.id === pluginId) {
                                hookResults[hookName] = {
                                    status: 'error',
                                    duration: Date.now() - t0,
                                    error: (e as Error).message,
                                    stack: (e as Error).stack,
                                }
                            }
                        }
                    }
                }
            }

            const modifiedRequestSnapshot = { headers: { ...requestMutable.headers }, body: requestMutable.body }
            const requestHeadersChanged = JSON.stringify(initialRequestSnapshot.headers) !== JSON.stringify(modifiedRequestSnapshot.headers)
            const requestBodyChanged = initialRequestSnapshot.body !== modifiedRequestSnapshot.body

            // --- Phase 1.5: onAfterRequest (请求处理阶段完成，即将发送) ---
            if (!shortCircuited && hooks.includes('onAfterRequest')) {
                const hookFn = (targetPlugin as Record<string, unknown>).onAfterRequest
                if (typeof hookFn === 'function') {
                    const hookCtx = {
                        log: testLogger,
                        request: requestMutable,
                        target: currentTarget,
                        meta: { _test: true, _pluginRequestStartAt: Date.now() },
                        requestSentAt: Date.now(),
                    }
                    const t0 = Date.now()
                    try {
                        await (hookFn as (c: unknown) => Promise<void>).call(targetPlugin, hookCtx)
                        hookResults['onAfterRequest'] = { status: 'success', duration: Date.now() - t0 }
                    } catch (e) {
                        hookResults['onAfterRequest'] = { status: 'error', duration: Date.now() - t0, error: (e as Error).message, stack: (e as Error).stack }
                    }
                }
            }

            // --- Phase 2: 发起真实 HTTP 请求 ---
            if (!shortCircuited) {
                if (!realResponse) {
                    const http = require('http') as typeof import('http')
                    const https = require('https') as typeof import('https')
                    const parsed = new URL(currentTarget)
                const transport = parsed.protocol === 'https:' ? https : http

                // SSL 验证配置 - 默认宽松（开发用），可通过环境变量 EP_SSL_VERIFY=true 开启严格验证
                const SSL_REJECT_UNAUTHORIZED = process.env.EP_SSL_VERIFY === 'true' || process.env.EP_SSL_VERIFY === '1'

                const fetchStart = Date.now()
                try {
                    realResponse = await new Promise<{ statusCode: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
                        const reqOpts = {
                            hostname: parsed.hostname,
                            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                            path: parsed.pathname + parsed.search,
                            method: requestMutable.method,
                            headers: requestMutable.headers,
                            timeout: 15000,
                            rejectUnauthorized: SSL_REJECT_UNAUTHORIZED,
                        }
                        const outReq = (transport as typeof https).request(reqOpts, (inRes) => {
                            const chunks: Buffer[] = []
                            inRes.on('data', (c: Buffer) => chunks.push(c))
                            inRes.on('end', () => {
                                const bodyBuf = Buffer.concat(chunks)
                                const hdrs: Record<string, string> = {}
                                for (const [k, v] of Object.entries(inRes.headers)) {
                                    if (v) hdrs[k] = Array.isArray(v) ? v.join(', ') : v
                                }
                                resolve({
                                    statusCode: inRes.statusCode || 0,
                                    headers: hdrs,
                                    body: bodyBuf.toString('utf-8'),
                                })
                            })
                        })
                        outReq.on('error', reject)
                        outReq.on('timeout', () => { outReq.destroy(); reject(new Error('请求超时 (15s)')) })
                        if (requestMutable.body) outReq.write(requestMutable.body)
                        outReq.end()
                    })
                } catch (e) {
                    fetchError = (e as Error).message
                }
                fetchDuration = Date.now() - fetchStart
                }
            }

            // --- Phase 3: onBeforeResponse / onAfterResponse（用真实响应） ---
            let modifiedResponse: Record<string, unknown> | null = null
            const originalBody = realResponse?.body || ''

            if (realResponse && !shortCircuited) {
                const responseCopy = {
                    statusCode: realResponse.statusCode,
                    headers: { ...realResponse.headers },
                    body: realResponse.body,
                }

                for (const hookName of ['onBeforeResponse', 'onAfterResponse']) {
                    if (!hooks.includes(hookName)) continue
                    const hookFn = (targetPlugin as Record<string, unknown>)[hookName]
                    if (typeof hookFn !== 'function') continue

                    const hookCtx = {
                        log: testLogger,
                        request: requestMutable,
                        target: currentTarget,
                        meta: { _test: true, _pluginRequestStartAt: Date.now() },
                        response: responseCopy,
                    }
                    const t0 = Date.now()
                    try {
                        await (hookFn as (c: unknown) => Promise<void>).call(targetPlugin, hookCtx)
                        hookResults[hookName] = { status: 'success', duration: Date.now() - t0 }
                    } catch (e) {
                        hookResults[hookName] = { status: 'error', duration: Date.now() - t0, error: (e as Error).message, stack: (e as Error).stack }
                    }
                }
                modifiedResponse = responseCopy
            }

            // --- Phase 4: 构造返回结果 ---
            const bodyChanged = modifiedResponse && (modifiedResponse.body !== originalBody)
            const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + `\n...(已截断，共 ${s.length} 字符)` : s
            const headersEqual = (a: Record<string, string>, b: Record<string, string>) =>
                JSON.stringify(a) === JSON.stringify(b)
            const responseHeadersChanged = !!(realResponse && modifiedResponse && !headersEqual(realResponse.headers, modifiedResponse.headers as Record<string, string>))
            const DIFF_PREVIEW_LEN = 2500

            // 写入代理日志，便于在「日志」页查看此次测试请求
            if (typeof ctx.appendProxyRecordFromPluginTest === 'function' && !fetchError) {
                const logData = {
                    method,
                    source,
                    target: usedMock ? `[MOCK] ${currentTarget}` : currentTarget,
                    time: new Date().toLocaleTimeString(),
                    statusCode: realResponse?.statusCode,
                    duration: fetchDuration,
                    _fromPluginTest: true,
                }
                const detail = realResponse
                    ? {
                        requestHeaders: requestMutable.headers,
                        requestBody: requestMutable.body || '',
                        responseHeaders: realResponse.headers,
                        responseBody: truncate(originalBody, 5000),
                        statusCode: realResponse.statusCode,
                        method,
                        url: source,
                    }
                    : undefined
                ctx.appendProxyRecordFromPluginTest(logData, detail)
            }

            res.json({
                status: 'success',
                results: {
                    pluginId,
                    pluginName: targetPlugin.manifest.name,
                    hooks,
                    logs: testLogs,
                    hookResults,
                    realRequest: {
                        method,
                        url: currentTarget,
                        fetchDuration,
                        fetchError,
                        usedMock,
                        targetResolved: integrated && legacyTarget !== source,
                        testMode: integrated ? 'integrated' : 'standalone',
                    },
                    originalRequest: (requestHeadersChanged || requestBodyChanged) ? {
                        headers: initialRequestSnapshot.headers,
                        body: initialRequestSnapshot.body,
                    } : null,
                    modifiedRequest: (requestHeadersChanged || requestBodyChanged) ? {
                        headers: modifiedRequestSnapshot.headers,
                        body: modifiedRequestSnapshot.body,
                    } : null,
                    requestHeadersChanged,
                    requestBodyChanged,
                    originalResponse: realResponse ? {
                        statusCode: realResponse.statusCode,
                        headers: realResponse.headers,
                        bodyPreview: truncate(originalBody, 3000),
                        bodyLength: originalBody.length,
                        bodyForDiff: truncate(originalBody, DIFF_PREVIEW_LEN),
                    } : null,
                    modifiedResponse: modifiedResponse ? (() => {
                        const h = modifiedResponse.headers as Record<string, unknown>
                        const headersNormalized = h ? Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v != null ? String(v) : ''])) : {}
                        return {
                            statusCode: modifiedResponse.statusCode,
                            headers: headersNormalized,
                            bodyPreview: truncate(String(modifiedResponse.body || ''), 3000),
                            bodyLength: String(modifiedResponse.body || '').length,
                            bodyChanged,
                            bodyForDiff: truncate(String(modifiedResponse.body || ''), DIFF_PREVIEW_LEN),
                        }
                    })() : null,
                    responseHeadersChanged,
                    shortCircuited,
                    shortCircuitResponse: shortCircuitResponse ? {
                        statusCode: (shortCircuitResponse as Record<string, unknown>).statusCode,
                        body: truncate(String((shortCircuitResponse as Record<string, unknown>).body || ''), 2000),
                    } : null,
                },
            })
        } catch (error) {
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // API: 启用/禁用单个插件
    app.put('/api/plugins/:id/toggle', (req: Request, res: Response) => {
        const pluginId = String(req.params.id)
        const { enabled } = req.body

        const allPlugins = ctx.pluginManager.getAll()
        const target = allPlugins.find(p => p.manifest.id === pluginId)
        if (!target) {
            res.status(404).json({ error: '插件不存在' })
            return
        }

        const newState = enabled ? 'running' : 'disabled'
        ctx.pluginManager.setState(pluginId, newState)

        // 持久化到 settings.json
        try {
            let settings: Record<string, unknown> = {}
            if (fs.existsSync(ctx.settingsPath)) {
                settings = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
            }
            const disabledPlugins: string[] = Array.isArray(settings.disabledPlugins)
                ? settings.disabledPlugins as string[]
                : []
            if (enabled) {
                settings.disabledPlugins = disabledPlugins.filter(id => id !== pluginId)
            } else {
                if (!disabledPlugins.includes(pluginId)) {
                    disabledPlugins.push(pluginId)
                }
                settings.disabledPlugins = disabledPlugins
            }
            fs.writeFileSync(ctx.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
        } catch (e) {
            console.error('保存插件状态失败:', e)
        }

        res.json({
            status: 'success',
            pluginId,
            state: newState,
        })
    })

    // API: 获取所有插件列表
    app.get('/api/plugins', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const pluginStats = ctx.hookDispatcher.getPluginStats ? ctx.hookDispatcher.getPluginStats() : {}
        const plugins = ctx.pluginManager.getAll().map((plugin) => ({
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            hooks: plugin.manifest.hooks,
            permissions: plugin.manifest.permissions,
            priority: plugin.manifest.priority,
            state: ctx.pluginManager.getState(plugin.manifest.id),
            stats: pluginStats[plugin.manifest.id] || null,
        }))
        res.write(JSON.stringify({
            mode: ctx.requestPipeline.mode,
            total: plugins.length,
            plugins,
        }))
        res.end()
    })

    // API: Logger 插件信息
    app.get('/api/plugins/logger', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const pluginStats = ctx.hookDispatcher.getPluginStats ? ctx.hookDispatcher.getPluginStats() : {}
        res.write(JSON.stringify({
            pluginId: 'builtin.logger',
            mode: ctx.requestPipeline.mode,
            stats: pluginStats['builtin.logger'] || null,
            summary: typeof ctx.builtinLoggerPlugin.getSummary === 'function'
                ? ctx.builtinLoggerPlugin.getSummary()
                : null,
            recent: typeof ctx.builtinLoggerPlugin.getRecentEntries === 'function'
                ? ctx.builtinLoggerPlugin.getRecentEntries()
                : [],
        }))
        res.end()
    })

    // API: Mock 插件信息
    app.get('/api/plugins/mock', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const pluginStats = ctx.hookDispatcher.getPluginStats ? ctx.hookDispatcher.getPluginStats() : {}
        const ENABLE_BUILTIN_MOCK_PLUGIN = true // This should come from REFACTOR_CONFIG
        res.write(JSON.stringify({
            pluginId: 'builtin.mock',
            enabled: ENABLE_BUILTIN_MOCK_PLUGIN,
            mode: ctx.requestPipeline.mode,
            stats: pluginStats['builtin.mock'] || null,
            takeoverRule: 'only inline mock in on mode and host-gated',
            allowlist: [], // Should come from context
        }))
        res.end()
    })

    // API: 插件健康检查
    app.get('/api/plugins/health', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json')
        const pluginStats = ctx.hookDispatcher.getPluginStats ? ctx.hookDispatcher.getPluginStats() : {}
        const pluginStates: Record<string, string> = {}
        const manifests = ctx.pluginManager.getAll().map((plugin) => {
            pluginStates[plugin.manifest.id] = ctx.pluginManager.getState(plugin.manifest.id)
            return plugin.manifest
        })
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildPluginHealth } = require('../core/plugin-health')
        const health = buildPluginHealth({
            plugins: manifests,
            pluginStates,
            pluginStats,
        })
        res.write(JSON.stringify({
            mode: ctx.requestPipeline.mode,
            ...health,
        }))
        res.end()
    })
}

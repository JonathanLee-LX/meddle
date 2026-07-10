#!/usr/bin/env node
/**
 * MCP Server for easy-proxy
 * 提供 start_proxy 与路由规则管理工具
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
// MCP SDK zod-compat 仅支持 zod/v3 或 zod/v4-mini 的内部结构，使用默认 zod 会报 _zod undefined
const z = require('zod/v3')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')

const epDir = path.resolve(os.homedir(), '.ep')
const mcpFile = path.join(epDir, 'mcp-proxy-url.json')
const DEFAULT_PROXY_BASE = 'http://127.0.0.1:9001'

let proxyProcess = null
let cachedProxyUrl = null

/** 获取代理 API 根地址（用于调用规则等接口） */
function getProxyBaseUrl() {
    if (cachedProxyUrl) return cachedProxyUrl
    try {
        if (fs.existsSync(mcpFile)) {
            const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'))
            if (data.proxyUrl) return data.proxyUrl
        }
    } catch (_) {}
    return DEFAULT_PROXY_BASE
}

const FILE_PATTERN = /^file:\/\//
const LOCAL_FILE_PATTERN = /^[A-Za-z]:\\|^\/|^\\/

/** 解析规则文件内容为 pattern -> target 对象（与 helpers.parseEprcWithExclusions 一致） */
function parseEprcWithExclusions(content) {
    const ruleMap = Object.create(null)
    const excludeMap = Object.create(null)
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return
        const parts = trimmed.split(/\s+/).filter(Boolean)
        if (parts.length < 2) return

        // Separate exclusions (tokens starting with !) from regular parts
        const exclusions = []
        const regularParts = parts.filter(p => {
            if (p.startsWith('!')) {
                exclusions.push(p.slice(1)) // Remove ! prefix
                return false
            }
            return true
        })

        if (regularParts.length < 2) return // Need at least one rule and one target

        let target = regularParts[regularParts.length - 1]
        const rules = regularParts.slice(0, -1)
        if (LOCAL_FILE_PATTERN.test(target) && !FILE_PATTERN.test(target)) {
            target = 'file://' + target.replace(/\\/g, '/')
        }
        rules.forEach((rule) => {
            const bm = rule.match(/\[([^\]]+)\]/)
            let patternKey
            if (bm) {
                patternKey = rule.replace(bm[0], bm[1])
                ruleMap[patternKey] = target + bm[0]
            } else {
                patternKey = rule
                ruleMap[patternKey] = target
            }
            // Always set exclusions (even empty array) to override any previous rule
            excludeMap[patternKey] = exclusions.slice() // Copy the array
        })
    })
    return { ruleMap, excludeMap }
}

function parseEprc(content) {
    return parseEprcWithExclusions(content).ruleMap
}

/** 将 pattern -> target 对象转回规则文件文本（与 helpers.ruleMapToEprcText 一致，保留 exclusions） */
function ruleMapToEprcText(ruleMap, excludeMap) {
    const entries = Object.entries(ruleMap)
    if (entries.length === 0) return ''
    const byTargetAndExclusions = {}
    entries.forEach(([rule, target]) => {
        const bm = target.match(/\[([^\]]+)\]/)
        const groupKey = bm ? target.replace(bm[0], '') : target
        const displayRule = bm ? rule.replace(bm[1], bm[0]) : rule
        const exclusions = excludeMap?.[rule] || []
        const exclusionsKey = exclusions.join(',')
        // Create a compound key that includes both target and exclusions
        const compoundKey = `${groupKey}|||${exclusionsKey}`
        if (!byTargetAndExclusions[compoundKey]) {
            byTargetAndExclusions[compoundKey] = { target: groupKey, rules: [], exclusions }
        }
        byTargetAndExclusions[compoundKey].rules.push(displayRule)
    })
    return Object.entries(byTargetAndExclusions)
        .map(([, { target, rules, exclusions }]) => {
            let displayTarget = target
            if (FILE_PATTERN.test(target)) {
                displayTarget = target.replace(/^file:\/\//, '').replace(/\//g, path.sep)
            }
            const exclusionStr = exclusions.map(e => `!${e}`).join(' ')
            const rulesStr = rules.join(' ')
            return exclusionStr ? `${rulesStr} ${exclusionStr} ${displayTarget}` : `${rulesStr} ${displayTarget}`
        })
        .join('\n')
}

/** 请求代理 API */
function proxyApi(method, pathname, body) {
    const base = getProxyBaseUrl()
    const url = base.replace(/\/$/, '') + pathname
    const opts = { method, headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body)
    return fetch(url, opts).then((res) => {
        const text = () => res.text()
        if (!res.ok) return text().then((t) => { throw new Error(t || res.statusText) })
        return res.headers.get('content-type')?.includes('application/json') ? res.json() : text()
    })
}

function waitForProxyUrl(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now()
        const interval = 50
        const check = () => {
            try {
                if (fs.existsSync(mcpFile)) {
                    const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'))
                    if (data.proxyUrl) {
                        return resolve(data.proxyUrl)
                    }
                }
            } catch (_) {}
            if (Date.now() - start > timeoutMs) {
                return reject(new Error('等待代理启动超时'))
            }
            setTimeout(check, interval)
        }
        check()
    })
}

const mcpServer = new McpServer({
    name: 'easy-proxy',
    version: '1.0.0'
})

mcpServer.registerTool('start_proxy', {
    description: '启动 easy-proxy 代理服务器，返回代理地址。',
    inputSchema: {}
}, async () => {
    if (proxyProcess && proxyProcess.exitCode === null) {
        return {
            content: [{ type: 'text', text: `代理已在运行: ${cachedProxyUrl}` }]
        }
    }
    proxyProcess = null
    cachedProxyUrl = null
    const indexPath = path.join(__dirname, 'index.js')
    const spawnEnv = { ...process.env, EP_MCP: '1', DEBUG: process.env.DEBUG || '' }
    const child = spawn(process.execPath, [indexPath], {
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd()
    })
    proxyProcess = child
    child.stdout?.on('data', (d) => process.stderr.write(d))
    child.stderr?.on('data', (d) => process.stderr.write(d))
    child.on('error', (err) => {
        proxyProcess = null
        console.error('启动代理失败:', err)
    })
    child.on('exit', (code) => {
        proxyProcess = null
        cachedProxyUrl = null
    })
    try {
        cachedProxyUrl = await waitForProxyUrl()
        return {
            content: [{ type: 'text', text: cachedProxyUrl }]
        }
    } catch (err) {
        proxyProcess = null
        child.kill()
        return {
            content: [{ type: 'text', text: `启动失败: ${err.message}` }],
            isError: true
        }
    }
})

mcpServer.registerTool('get_proxy_url', {
    description: '获取当前代理服务器 URL（用于配置系统代理或调用代理 API）。来源：本会话通过 start_proxy 启动的地址、~/.ep/mcp-proxy-url.json，或默认 http://127.0.0.1:9001。',
    inputSchema: {}
}, async () => {
    const url = getProxyBaseUrl()
    return { content: [{ type: 'text', text: url }] }
})

// ---------- Mock 规则（需代理已启动） ----------

mcpServer.registerTool('mock_rule_list', {
    description: '列出所有 Mock 规则。返回 id、name、urlPattern、method、statusCode、enabled 等。',
    inputSchema: {}
}, async () => {
    try {
        const rules = await proxyApi('GET', '/api/mocks')
        return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('mock_rule_add', {
    description: '添加一条 Mock 规则。匹配到的请求将返回指定状态码、响应头和响应体。',
    inputSchema: {
        name: z.string().describe('规则名称，便于识别'),
        urlPattern: z.string().describe('URL 匹配正则或字符串，如 example\\.com/api 或 .*\\.example\\.com'),
        method: z.string().optional().describe('HTTP 方法，如 GET、POST、* 表示全部，默认 *'),
        statusCode: z.number().optional().describe('响应状态码，默认 200'),
        headers: z.record(z.string()).optional().describe('响应头，如 {"content-type":"application/json"}'),
        body: z.string().optional().describe('响应体内容，默认空'),
        bodyType: z.string().optional().describe('body 类型，如 inline，默认 inline'),
        delay: z.number().optional().describe('延迟毫秒数，默认 0'),
        enabled: z.boolean().optional().describe('是否启用，默认 true')
    }
}, async (params) => {
    try {
        const body = {
            name: params.name ?? '',
            urlPattern: params.urlPattern ?? '',
            method: params.method ?? '*',
            statusCode: params.statusCode ?? 200,
            delay: params.delay ?? 0,
            bodyType: params.bodyType ?? 'inline',
            headers: params.headers ?? {},
            body: params.body ?? '',
            enabled: params.enabled !== false
        }
        const result = await proxyApi('POST', '/api/mocks', body)
        const rule = result.rule || result
        return {
            content: [{ type: 'text', text: `已添加 Mock 规则 id=${rule.id}: ${rule.name} (${rule.urlPattern})` }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('mock_rule_update', {
    description: '按 id 更新一条 Mock 规则，只传需要修改的字段。',
    inputSchema: {
        id: z.number().describe('规则 id，从 mock_rule_list 获取'),
        name: z.string().optional(),
        urlPattern: z.string().optional(),
        method: z.string().optional(),
        statusCode: z.number().optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
        bodyType: z.string().optional(),
        delay: z.number().optional(),
        enabled: z.boolean().optional()
    }
}, async (params) => {
    try {
        const id = params.id
        const updates = { ...params }
        delete updates.id
        if (Object.keys(updates).length === 0) {
            return { content: [{ type: 'text', text: '未提供要更新的字段' }], isError: true }
        }
        const result = await proxyApi('PUT', `/api/mocks/${id}`, updates)
        const rule = result.rule || result
        return {
            content: [{ type: 'text', text: `已更新 Mock 规则 id=${id}: ${rule.name ?? '(未改)'}` }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('mock_rule_delete', {
    description: '按 id 删除一条 Mock 规则。',
    inputSchema: {
        id: z.number().describe('规则 id，从 mock_rule_list 获取')
    }
}, async ({ id }) => {
    try {
        await proxyApi('DELETE', `/api/mocks/${id}`)
        return { content: [{ type: 'text', text: `已删除 Mock 规则 id=${id}` }] }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

// ---------- 路由规则（需代理已启动，API 地址来自 start_proxy 或 ~/.ep/mcp-proxy-url.json） ----------

mcpServer.registerTool('route_rule_list', {
    description: '列出所有路由规则文件；可选指定 ruleFile 获取该文件下的规则列表（pattern -> target 及 exclusions）。路由匹配规则：按文件内顺序逐条匹配，pattern 对完整 URL 匹配，支持正则/通配符/[marker]路径重写/exclusions排除规则。',
    inputSchema: {
        ruleFile: z.string().optional().describe('规则文件名（不含 .txt），不传则只返回文件列表')
    }
}, async ({ ruleFile }) => {
    try {
        const files = await proxyApi('GET', '/api/rule-files')
        if (!ruleFile) {
            return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] }
        }
        const name = encodeURIComponent(ruleFile.trim())
        const content = await proxyApi('GET', `/api/rule-files/${name}/content`)
        const { ruleMap, excludeMap } = parseEprcWithExclusions(typeof content === 'string' ? content : String(content))
        const displayRules = {}
        for (const [pat, tgt] of Object.entries(ruleMap)) {
            const bm = tgt.match(/\[([^\]]+)\]/)
            const displayPat = bm ? pat.replace(bm[1], bm[0]) : pat
            const displayTgt = bm ? tgt.replace(bm[0], '') : tgt
            displayRules[displayPat] = {
                target: displayTgt,
                exclusions: excludeMap[pat] || []
            }
        }
        // Calculate exclusion count
        let totalExclusions = 0
        for (const exclusions of Object.values(excludeMap)) {
            totalExclusions += exclusions.length
        }
        return {
            content: [{ type: 'text', text: JSON.stringify({ ruleFile, rules: displayRules, ruleCount: Object.keys(displayRules).length, exclusionCount: totalExclusions }, null, 2) }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_active_get', {
    description: '查看当前激活的路由规则文件。返回所有已启用规则文件；若只有一个启用文件，则同时给出 currentRuleFile。',
    inputSchema: {}
}, async () => {
    try {
        const files = await proxyApi('GET', '/api/rule-files')
        const activeRuleFiles = Array.isArray(files) ? files.filter((item) => item && item.enabled) : []
        const currentRuleFile = activeRuleFiles.length === 1 ? activeRuleFiles[0].name : null
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    currentRuleFile,
                    activeRuleFiles: activeRuleFiles.map((item) => item.name),
                    count: activeRuleFiles.length
                }, null, 2)
            }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_active_set', {
    description: '设置当前激活的路由规则文件。该操作会启用指定规则文件，并禁用其他所有规则文件，使其成为唯一激活文件。',
    inputSchema: {
        ruleFile: z.string().describe('要设为当前激活的规则文件名（不含 .txt）')
    }
}, async ({ ruleFile }) => {
    try {
        const targetName = ruleFile.trim()
        const files = await proxyApi('GET', '/api/rule-files')
        if (!Array.isArray(files)) {
            throw new Error('规则文件列表返回格式错误')
        }
        const targetFile = files.find((item) => item && item.name === targetName)
        if (!targetFile) {
            return { content: [{ type: 'text', text: `未找到规则文件: ${targetName}` }], isError: true }
        }

        for (const item of files) {
            const nextEnabled = item.name === targetName
            if (!!item.enabled === nextEnabled) continue
            const name = encodeURIComponent(item.name)
            await proxyApi('PUT', `/api/rule-files/${name}`, { enabled: nextEnabled })
        }

        return {
            content: [{
                type: 'text',
                text: `已将当前激活路由规则设置为: ${targetName}`
            }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_create_file', {
    description: '创建新的路由规则文件（多套规则中的一套）。文件名不含 .txt，创建后可启用并往该文件中添加规则。路由匹配规则：按文件内顺序逐条匹配，命中第一条后立即停止。',
    inputSchema: {
        name: z.string().describe('规则文件名称（不含 .txt），如 dev、staging；非法字符会被替换为下划线'),
        content: z.string().optional().describe('初始规则内容，每行一条规则。格式：「pattern1 pattern2 ... !exclusion1 !exclusion2 ... target」。规则：多个 pattern 共享同一 target；target 固定在最后；! 前缀表示 exclusion。pattern 匹配完整 URL，支持正则/通配符(如 *.wps.cn)/[marker]路径重写。target 若仅 host:port 则继承原请求协议/path/query。'),
        enabled: z.boolean().optional().describe('是否加入当前启用的规则集，默认 true')
    }
}, async ({ name, content = '', enabled = true }) => {
    try {
        const body = { name: name.trim(), content: content.trim(), enabled }
        const result = await proxyApi('POST', '/api/rule-files', body)
        const rf = result.ruleFile || result
        return {
            content: [{
                type: 'text',
                text: `已创建规则文件: ${rf.name}（启用: ${rf.enabled}，规则数: ${rf.ruleCount ?? 0}）`
            }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_add', {
    description: '在指定规则文件中添加一条路由规则（pattern -> target）。若 pattern 已存在则覆盖。路由匹配规则：按文件内顺序逐条匹配，命中第一条后立即停止。pattern 对完整 URL 匹配（非仅 host）。支持 [marker] 路径重写和 exclusions 排除规则。',
    inputSchema: {
        ruleFile: z.string().describe('规则文件名（不含 .txt）'),
        pattern: z.string().describe('匹配完整请求 URL。支持：(1) 正则表达式，如 ^https://a\\.com/api； (2) 通配符，如 *.wps.cn 匹配 wps.cn、plus.wps.cn、deep.plus.wps.cn；(3) [marker] 路径重写，如 ^https://cdn.com/[assets] 将 assets 后的路径拼接到 target'),
        target: z.string().describe('转发目标。若仅 host:port 则继承原请求的协议、pathname、query；若完整 URL 则直接使用；若原请求是 websocket 而 target 是 http(s)，自动转为 ws(s)'),
        exclusions: z.array(z.string()).optional().describe('排除规则列表，匹配完整 URL。若任一 exclusion 命中则跳过此规则继续匹配下一条。如 ["api/health", "^https://a\\.com/internal"]')
    }
}, async ({ ruleFile, pattern, target, exclusions }) => {
    try {
        const name = encodeURIComponent(ruleFile.trim())
        let content
        try {
            content = await proxyApi('GET', `/api/rule-files/${name}/content`)
        } catch (err) {
            return { content: [{ type: 'text', text: `规则文件不存在或代理未启动: ${err.message}` }], isError: true }
        }
        const text = typeof content === 'string' ? content : String(content)
        const { ruleMap, excludeMap } = parseEprcWithExclusions(text)
        const pat = pattern.trim()
        const tgt = target.trim()
        const bm = pat.match(/\[([^\]]+)\]/)
        if (bm) {
            ruleMap[pat.replace(bm[0], bm[1])] = tgt + bm[0]
            excludeMap[pat.replace(bm[0], bm[1])] = exclusions || []
        } else {
            ruleMap[pat] = tgt
            excludeMap[pat] = exclusions || []
        }
        const newContent = ruleMapToEprcText(ruleMap, excludeMap)
        await proxyApi('PUT', `/api/rule-files/${name}/content`, { content: newContent })
        const exclusionInfo = exclusions && exclusions.length > 0 ? `，排除规则: ${exclusions.join(', ')}` : ''
        return { content: [{ type: 'text', text: `已添加规则: ${pattern} -> ${target}${exclusionInfo}` }] }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_update', {
    description: '修改指定规则文件中某条规则的 target 和 exclusions（按 pattern 查找）。pattern 中如包含 [marker] 会自动匹配内部存储格式。',
    inputSchema: {
        ruleFile: z.string().describe('规则文件名（不含 .txt）'),
        pattern: z.string().describe('要修改的 pattern（需与现有规则一致，支持带 [marker] 的写法）'),
        newTarget: z.string().optional().describe('新的转发目标。若仅 host:port 则继承原请求的协议、pathname、query；若完整 URL 则直接使用'),
        exclusions: z.array(z.string()).optional().describe('新的排除规则列表，匹配完整 URL。设为空数组 [] 可清除所有排除规则')
    }
}, async ({ ruleFile, pattern, newTarget, exclusions }) => {
    try {
        const name = encodeURIComponent(ruleFile.trim())
        const pat = pattern.trim()
        let content
        try {
            content = await proxyApi('GET', `/api/rule-files/${name}/content`)
        } catch (err) {
            return { content: [{ type: 'text', text: `规则文件不存在或代理未启动: ${err.message}` }], isError: true }
        }
        const text = typeof content === 'string' ? content : String(content)
        const { ruleMap, excludeMap } = parseEprcWithExclusions(text)
        const bm = pat.match(/\[([^\]]+)\]/)
        const internalKey = bm ? pat.replace(bm[0], bm[1]) : pat
        if (!Object.prototype.hasOwnProperty.call(ruleMap, internalKey)) {
            return { content: [{ type: 'text', text: `未找到 pattern: ${pat}` }], isError: true }
        }
        if (newTarget) {
            const tgt = newTarget.trim()
            ruleMap[internalKey] = bm ? tgt + bm[0] : tgt
        }
        if (exclusions !== undefined) {
            excludeMap[internalKey] = exclusions
        }
        const newContent = ruleMapToEprcText(ruleMap, excludeMap)
        await proxyApi('PUT', `/api/rule-files/${name}/content`, { content: newContent })
        const targetInfo = newTarget ? `目标: ${newTarget}` : ''
        const exclusionInfo = exclusions !== undefined ? (exclusions.length > 0 ? `排除规则: ${exclusions.join(', ')}` : '已清除排除规则') : ''
        const parts = [targetInfo, exclusionInfo].filter(Boolean).join(', ')
        return { content: [{ type: 'text', text: `已更新规则: ${pat}${parts ? ` (${parts})` : ''}` }] }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_rule_delete', {
    description: '从指定规则文件中删除一条路由规则（按 pattern）。pattern 中如包含 [marker] 会自动匹配内部存储格式。',
    inputSchema: {
        ruleFile: z.string().describe('规则文件名（不含 .txt）'),
        pattern: z.string().describe('要删除的 pattern（需与现有规则一致，支持带 [marker] 的写法）')
    }
}, async ({ ruleFile, pattern }) => {
    try {
        const name = encodeURIComponent(ruleFile.trim())
        const pat = pattern.trim()
        let content
        try {
            content = await proxyApi('GET', `/api/rule-files/${name}/content`)
        } catch (err) {
            return { content: [{ type: 'text', text: `规则文件不存在或代理未启动: ${err.message}` }], isError: true }
        }
        const text = typeof content === 'string' ? content : String(content)
        const { ruleMap, excludeMap } = parseEprcWithExclusions(text)
        const bm = pat.match(/\[([^\]]+)\]/)
        const internalKey = bm ? pat.replace(bm[0], bm[1]) : pat
        if (!Object.prototype.hasOwnProperty.call(ruleMap, internalKey)) {
            return { content: [{ type: 'text', text: `未找到 pattern: ${pat}` }], isError: true }
        }
        delete ruleMap[internalKey]
        delete excludeMap[internalKey]
        const newContent = ruleMapToEprcText(ruleMap, excludeMap)
        await proxyApi('PUT', `/api/rule-files/${name}/content`, { content: newContent })
        return { content: [{ type: 'text', text: `已删除规则: ${pat}` }] }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

mcpServer.registerTool('route_preview', {
    description: '预览指定 URL 的路由转发目标。模拟路由匹配过程，返回命中的规则、目标地址和解析后的完整 URL。用于 Agent 验证路由规则是否正确配置。匹配逻辑与实际代理一致：按规则顺序匹配，pattern 对完整 URL 匹配，支持正则/通配符/[marker]路径重写/exclusions排除规则。',
    inputSchema: {
        url: z.string().describe('待预览的完整 URL，如 https://api.example.com/v1/users'),
        ruleFile: z.string().optional().describe('可选的规则文件名（不含 .txt），不传则使用所有已激活的规则文件'),
        rulesText: z.string().optional().describe('可选的自定义规则文本（多行），用于测试临时规则；若提供则忽略 ruleFile 参数')
    }
}, async ({ url, ruleFile, rulesText }) => {
    try {
        let actualRulesText = rulesText

        if (!actualRulesText) {
            // Get rules from specified file or all active files
            const base = getProxyBaseUrl()

            if (ruleFile) {
                // Use specified rule file
                const content = await proxyApi('GET', `/api/rule-files/${encodeURIComponent(ruleFile.trim())}/content`)
                actualRulesText = typeof content === 'string' ? content : String(content)
            } else {
                // Use all active rule files
                const files = await proxyApi('GET', '/api/rule-files')
                const activeFiles = Array.isArray(files) ? files.filter(item => item && item.enabled) : []

                const contents = []
                for (const file of activeFiles) {
                    const content = await proxyApi('GET', `/api/rule-files/${encodeURIComponent(file.name)}/content`)
                    if (content) {
                        contents.push(typeof content === 'string' ? content : String(content))
                    }
                }
                actualRulesText = contents.join('\n')
            }
        }

        if (!actualRulesText || !actualRulesText.trim()) {
            return {
                content: [{ type: 'text', text: '无可用规则：请先创建并激活路由规则文件，或提供 rulesText 参数' }],
                isError: true
            }
        }

        // Call preview API
        const result = await proxyApi('POST', '/api/rules/preview', { url: url.trim(), rulesText: actualRulesText })

        // Format output
        const output = {
            inputUrl: result.inputUrl,
            matched: result.matched,
            resolvedUrl: result.resolvedUrl,
            notes: result.notes
        }

        if (result.matched && result.matchedRule) {
            output.matchedRule = {
                pattern: result.matchedRule.pattern,
                target: result.matchedRule.target,
                kind: result.matchedRule.kind
            }
        }

        return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true }
    }
})

async function main() {
    const transport = new StdioServerTransport()
    await mcpServer.connect(transport)
}

main().catch((err) => {
    console.error('MCP Server error:', err)
    process.exit(1)
})

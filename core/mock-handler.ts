import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import chokidar from 'chokidar'
import _debug from 'debug'
import { getMimeType } from './map-local'
import { appendProxyRecord } from './proxy-record'
import { getRequestClientIdentity } from './client-identity'
import { safeBodyToDetail } from './body-utils'
import type { ProxyContext, MockHandler, MockRuleEntry } from './types'
import {
    matchUrlPattern,
    matchQueryCondition,
    resolveHeaderPlaceholders,
    mergeResponseHeaders,
    ensureUniqueMockRuleIds,
    nextMockRuleId,
} from './mock-utils'

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

export interface MocksParseError {
    /** 1-based line of the parse failure (null when the engine gives no position). */
    line: number | null
    /** 1-based column of the parse failure. */
    column: number | null
    /** Raw JSON.parse message. */
    message: string
}

/** Thrown when a write would overwrite a mocks file that failed to parse (issue #120). */
export class MocksFileInvalidError extends Error {
    readonly code = 'MOCKS_FILE_INVALID'
    constructor(readonly filePath: string, readonly parseError: MocksParseError) {
        super(formatMocksParseError(filePath, parseError))
        this.name = 'MocksFileInvalidError'
    }
}

export function formatMocksParseError(filePath: string, err: MocksParseError): string {
    const loc = err.line != null ? `第 ${err.line} 行第 ${err.column} 列：` : ''
    return `Mock 文件格式错误，已禁止写入以免覆盖: ${filePath} ${loc}${err.message}`
}

/**
 * Parse mocks file text. Issue #120: empty / whitespace-only text is an empty
 * rule list (not an error); anything else that fails JSON.parse returns a
 * parse error with 1-based line/column.
 */
export function parseMocksFileText(text: string): { data: any; error: null } | { data: null; error: MocksParseError } {
    if (text.replace(/^\uFEFF/, '').trim() === '') return { data: {}, error: null }
    try {
        return { data: JSON.parse(text.replace(/^\uFEFF/, '')), error: null }
    } catch (e: any) {
        const message = String(e?.message || e)
        let line: number | null = null
        let column: number | null = null
        const body = text.replace(/^\uFEFF/, '')
        const lc = /\(line (\d+) column (\d+)\)/.exec(message)
        const pos = /at position (\d+)/.exec(message)
        const offset = lc ? null : pos ? Number(pos[1]) : findJsonErrorOffset(body)
        if (lc) {
            line = Number(lc[1]); column = Number(lc[2])
        } else {
            const before = body.slice(0, offset ?? body.length).split('\n')
            line = before.length; column = before[before.length - 1].length + 1
        }
        // Drop V8's quoted source snippet and the "(line x column y)" suffix; position is reported separately.
        const short = message.replace(/\s*\(line \d+ column \d+\)/, '').split(/,\s*(?:\.\.\.)?"/s)[0].replace(/\s+in JSON at position \d+/, '').trim()
        return { data: null, error: { line, column, message: short } }
    }
}

/**
 * Offset of the first JSON syntax error (V8 does not always report a
 * position, e.g. "Unexpected token ']', ... is not valid JSON").
 */
export function findJsonErrorOffset(t: string): number {
    let i = 0
    const ws = () => { while (i < t.length && ' \t\n\r'.includes(t[i])) i++ }
    const fail = (): never => { throw i }
    const str = () => {
        i++
        while (i < t.length && t[i] !== '"') {
            if (t[i] === '\\') i++
            else if (t.charCodeAt(i) < 0x20) fail()
            i++
        }
        if (i >= t.length) fail()
        i++
    }
    const value = (): void => {
        ws()
        const c = t[i]
        if (c === '{') {
            i++; ws()
            if (t[i] === '}') { i++; return }
            for (;;) {
                ws(); if (t[i] !== '"') fail(); str(); ws()
                if (t[i] !== ':') fail(); i++; value(); ws()
                if (t[i] === ',') { i++; continue }
                if (t[i] === '}') { i++; return }
                fail()
            }
        } else if (c === '[') {
            i++; ws()
            if (t[i] === ']') { i++; return }
            for (;;) {
                value(); ws()
                if (t[i] === ',') { i++; continue }
                if (t[i] === ']') { i++; return }
                fail()
            }
        } else if (c === '"') str()
        else if (/[-0-9]/.test(c || '')) {
            const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i))
            if (!m) fail(); i += m![0].length
        } else {
            for (const w of ['true', 'false', 'null']) if (t.startsWith(w, i)) { i += w.length; return }
            fail()
        }
    }
    try {
        value(); ws()
        return i < t.length ? i : t.length
    } catch (at) {
        return typeof at === 'number' ? Math.min(at, t.length) : t.length
    }
}

/**
 * Issue #123: the real file a write to `file` must replace. Symlinks are
 * followed so the link itself is never replaced. A dangling link (target
 * missing) creates the target at the link destination when its directory
 * exists, otherwise throws a clear error (the link is left untouched).
 */
export function resolveMocksWriteTarget(file: string): string {
    try { return fs.realpathSync(file) } catch (_) { /* missing or dangling */ }
    let cur = path.resolve(file)
    for (let hops = 0; hops < 40; hops++) {
        let st: fs.Stats
        try { st = fs.lstatSync(cur) } catch (_) { break }
        if (!st.isSymbolicLink()) break
        cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur))
    }
    if (cur !== path.resolve(file)) {
        const parent = path.dirname(cur)
        let parentReal: string
        try { parentReal = fs.realpathSync(parent) } catch (_) {
            throw new Error(`Mock 文件是指向不存在位置的符号链接，无法写入: ${file} -> ${cur}（目录 ${parent} 不存在）`)
        }
        return path.join(parentReal, path.basename(cur))
    }
    return cur
}

/**
 * Issue #121: turn the configured `mocksFilePath` into an absolute path.
 * `~` / `~/…` expand to the user's home directory; a relative path is
 * resolved against the meddle directory (MEDDLE_HOME), not the directory the
 * proxy happened to be started from.
 */
export function resolveConfiguredMocksPath(raw: string | null | undefined, meddleDir: string, homeDir: string = os.homedir()): string | null {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v) return null
    let p = v
    if (p === '~') p = homeDir
    else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(homeDir, p.slice(2))
    return path.resolve(meddleDir, p)
}

export interface LegacyMocksPath {
    /** What the user configured (a relative path). */
    configured: string
    /** Where the file was found under the old rule (relative to the proxy's start directory). */
    oldPath: string
    /** Where the path resolves now (relative to MEDDLE_HOME); does not exist. */
    newPath: string
}

/**
 * Issue #121 migration notice: a relative `mocksFilePath` used to resolve
 * against the proxy's start directory. If the file exists there but not
 * under the new rule (MEDDLE_HOME), report both paths so the user can switch
 * to the old absolute path. Never migrates or rewrites settings.
 */
export function detectLegacyMocksPath(raw: string | null | undefined, meddleDir: string, cwd: string = process.cwd(), homeDir: string = os.homedir()): LegacyMocksPath | null {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v || path.isAbsolute(v) || v === '~' || v.startsWith('~/') || v.startsWith('~\\')) return null
    const newPath = resolveConfiguredMocksPath(v, meddleDir, homeDir)
    const oldPath = path.resolve(cwd, v)
    if (!newPath || oldPath === newPath) return null
    const isFile = (p: string) => { try { return fs.statSync(p).isFile() } catch (_) { return false } }
    if (!isFile(oldPath) || isFile(newPath)) return null
    return { configured: v, oldPath, newPath }
}

export function formatLegacyMocksNotice(l: LegacyMocksPath): string {
    return `Mock 文件路径「${l.configured}」现在相对于 Meddle 配置目录解析为 ${l.newPath}（不存在）；` +
        `按旧规则（相对于启动目录）找到的文件是 ${l.oldPath}。如需继续使用它，请把路径改为该绝对路径。`
}

/** Read the raw (unresolved) mocksFilePath from settings.json. */
export function readConfiguredMocksPath(settingsPath: string): string | null {
    try {
        if (!fs.existsSync(settingsPath)) return null
        const v = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).mocksFilePath
        return typeof v === 'string' ? v : null
    } catch (_) { return null }
}

export function createMockHandler(ctx: ProxyContext): MockHandler {
    const DEFAULT_MOCK_FILE = path.join(ctx.meddleDir, 'mocks.json')

    function loadCustomPathsFromSettings(): { mocksFilePath: string | null } {
        try {
            if (fs.existsSync(ctx.settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
                return { mocksFilePath: resolveConfiguredMocksPath(settings.mocksFilePath, ctx.meddleDir) }
            }
        } catch (error) {
            console.error('加载自定义配置路径失败:', error)
        }
        return { mocksFilePath: null }
    }

    /**
     * Effective mocks file. Issue #118: a configured `mocksFilePath` is honoured
     * even when the file does not exist yet (same as the CLI file mode) — the
     * proxy starts with an empty rule list and the file is created on the first
     * save. Previously a missing custom file silently fell back to the default
     * file, so "switching" to a new file kept reading/writing the old one.
     */
    function getMockFilePath(): string {
        if (ctx.currentMocksPath) return ctx.currentMocksPath
        const customPaths = loadCustomPathsFromSettings()
        ctx.currentMocksPath = customPaths.mocksFilePath || DEFAULT_MOCK_FILE
        return ctx.currentMocksPath
    }

    /** Path whose contents are currently in ctx.mockRules (null before first load). */
    let loadedMocksPath: string | null = null
    /** Issue #120: parse failure of the loaded file; while set, every write is refused. */
    let parseError: MocksParseError | null = null
    function getMocksParseError(): MocksParseError | null { return parseError }

    /**
     * Issue #123 (CI flake root cause): chokidar does not report writes that
     * land while it is still setting up (ignoreInitial). Remember what was
     * loaded so the watcher can re-check once it is ready.
     */
    let loadedSig: string | null = null
    function fileSig(file: string): string {
        try { const st = fs.statSync(file); return `${st.ino}:${st.size}:${st.mtimeMs}` } catch (_) { return 'missing' }
    }

    function loadMockRules(): void {
        const mockFile = getMockFilePath()
        // Issue #118: switching to another file must not inherit the old
        // file's id counter or rules; re-reading the same file keeps the
        // counter monotonic (issue #115).
        const switched = loadedMocksPath !== null && loadedMocksPath !== mockFile
        const firstLoadOfThisFile = loadedMocksPath !== mockFile
        if (switched) {
            proxyDebug(`Mock 文件切换: ${loadedMocksPath} -> ${mockFile}`)
            ctx.mockIdSeq = 1
        }
        loadedMocksPath = mockFile
        if (watcherState && watcherState.file !== mockFile) startWatcher(mockFile)
        try {
            if (fs.existsSync(mockFile)) {
                loadedSig = fileSig(mockFile)
                const parsed = parseMocksFileText(fs.readFileSync(mockFile, 'utf8'))
                if (parsed.error) {
                    // Issue #120: never treat a broken file as empty-and-writable.
                    const wasSame = parseError && parseError.message === parsed.error.message && parseError.line === parsed.error.line
                    parseError = parsed.error
                    ctx.mockRules = []
                    if (!wasSame) console.error(formatMocksParseError(mockFile, parsed.error))
                    return
                }
                if (parseError) console.log(`Mock 文件已修复，恢复正常: ${mockFile}`)
                parseError = null
                const data = parsed.data || {}
                const loaded = Array.isArray(data.rules) ? data.rules : []
                // Issue #115: never drop rules that share an id — give the
                // later duplicates fresh ids instead (no silent data loss).
                const { rules, reassigned } = ensureUniqueMockRuleIds(loaded as MockRuleEntry[])
                ctx.mockRules = rules
                if (reassigned > 0) {
                    console.warn(`Mock 规则 id 重复或缺失，已为 ${reassigned} 条规则重新分配 id (${mockFile})`)
                }
                // nextId is the next id to hand out; a stale/missing value must
                // never collide with ids already on disk (issue #115).
                ctx.mockIdSeq = nextMockRuleId(ctx.mockRules, Math.max(
                    Number(data.nextId) || 0,
                    (Number(data.lastId) || 0) + 1,
                    ctx.mockIdSeq || 0,
                ))
                proxyDebug(`已加载 ${ctx.mockRules.length} 条 Mock 规则 (${mockFile})`)
            } else {
                // File removed / never created — clear in-memory rules (watcher
                // unlink, or a configured path that does not exist yet). The
                // file is created on the first save; nothing else is touched.
                ctx.mockRules = []
                parseError = null
                loadedSig = 'missing'
                if (firstLoadOfThisFile && mockFile !== DEFAULT_MOCK_FILE) {
                    console.warn(`Mock 规则文件不存在，将以空列表开始，首次保存时创建: ${mockFile}`)
                }
                proxyDebug(`Mock 规则文件不存在，已清空内存规则 (${mockFile})`)
            }
        } catch (err: any) {
            console.error('加载 mock 规则失败:', err.message)
            ctx.mockRules = []
        }
    }

    function assertMocksWritable(): void {
        const mockFile = getMockFilePath()
        // Re-validate what is on disk right before writing: the file may have
        // been broken after the last load (watcher not fired yet, stale tab).
        if (!parseError && fs.existsSync(mockFile)) {
            try {
                const parsed = parseMocksFileText(fs.readFileSync(mockFile, 'utf8'))
                if (parsed.error) {
                    parseError = parsed.error
                    console.error(formatMocksParseError(mockFile, parsed.error))
                }
            } catch (_) { /* unreadable: let the write report it */ }
        }
        if (parseError) throw new MocksFileInvalidError(mockFile, parseError)
    }

    function saveMockRules(): void {
        // Issue #120: single choke point for every write — refuse to overwrite a broken file.
        assertMocksWritable()
        try {
            // Issue #115: keep every rule (re-id duplicates instead of dropping
            // them) and persist a sequence that is above every stored id.
            ctx.mockRules = ensureUniqueMockRuleIds(ctx.mockRules).rules
            ctx.mockIdSeq = nextMockRuleId(ctx.mockRules, ctx.mockIdSeq)
            const mockFile = getMockFilePath()
            const dir = path.dirname(mockFile)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            // Issue #123: write next to the real file so a symlinked mocks file
            // (e.g. into a dotfiles repo) stays a symlink, and keep its mode/owner.
            const target = resolveMocksWriteTarget(mockFile)
            let existing: fs.Stats | null = null
            try { existing = fs.statSync(target) } catch (_) { /* new file */ }
            // Write to a temp file then rename, so a crash never leaves half a file (issue #120).
            const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
            fs.writeFileSync(tmp, JSON.stringify({ nextId: ctx.mockIdSeq, rules: ctx.mockRules }, null, 2), { encoding: 'utf8', mode: existing ? existing.mode & 0o7777 : 0o666 })
            try {
                if (existing) {
                    fs.chmodSync(tmp, existing.mode & 0o7777)
                    try { fs.chownSync(tmp, existing.uid, existing.gid) } catch (_) { /* not permitted: best effort */ }
                }
                fs.renameSync(tmp, target)
                loadedSig = fileSig(mockFile)
            } catch (e) {
                try { fs.unlinkSync(tmp) } catch (_) { /* ignore */ }
                throw e
            }
            proxyDebug(`Mock 规则已保存到 ${mockFile}`)
        } catch (err: any) {
            console.error('保存 mock 规则失败:', err.message)
            throw err
        }
    }

    function matchMockRule(url: string, method: string): MockRuleEntry | null {
        return ctx.mockRules.find(rule => {
            if (!rule.enabled) return false
            if (rule.method && rule.method !== '*' && rule.method.toUpperCase() !== method.toUpperCase()) return false
            if (!matchUrlPattern(url, rule.urlPattern)) return false
            if (!matchQueryCondition(url, rule.query)) return false
            return true
        }) || null
    }

    function buildMockResponseForTest(rule: MockRuleEntry, requestHeaders?: Record<string, any>): { statusCode: number; headers: Record<string, string>; body: string } {
        const statusCode = rule.statusCode || 200
        const ruleHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(rule.headers || {})) {
            ruleHeaders[key.toLowerCase()] = value
        }
        const headers: Record<string, string> = resolveHeaderPlaceholders(
            mergeResponseHeaders(
                {
                    'x-mock-rule': encodeURIComponent(rule.name || rule.id?.toString() || rule.urlPattern || ''),
                    'content-type': 'application/json',
                },
                ruleHeaders,
            ),
            requestHeaders,
        )
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
            const responseHeaders: Record<string, any> = resolveHeaderPlaceholders(
                mergeResponseHeaders(
                    {
                        'X-Mock-Rule': encodeURIComponent(mockRuleName),
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    ruleHeaders,
                ),
                req.headers,
            )
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
                    ...getRequestClientIdentity(req),
                    mockRuleId: rule.id,
                    mockRuleName: rule.name,
                }
                const _mdLimit = ctx.resolveDetailBodySizeBytes()
                const _mdResBody = Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(typeof responseBody === 'string' ? responseBody : '', 'utf8')
                const _mdRes = safeBodyToDetail(_mdResBody, _mdLimit)
                const detail: ProxyContext['proxyRecordDetailMap'] extends Map<number, infer T> ? T : never = {
                    requestHeaders: req.headers || {}, requestBody: '',
                    requestBodyTruncated: false, requestBodyOriginalBytes: 0,
                    responseHeaders, responseBody: _mdRes.text,
                    responseBodyTruncated: _mdRes.truncated, responseBodyOriginalBytes: _mdRes.originalBytes,
                    statusCode: finalStatusCode,
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

    /** Active file watcher (issue #118: follows the effective mocks file). */
    let watcherState: { file: string; close: () => void } | null = null
    let watcherOnReload: (() => void) | undefined

    function startWatcher(mockFile: string): void {
        if (watcherState) {
            watcherState.close()
            proxyDebug(`stopped watching mocks file: ${watcherState.file}`)
        }
        const dir = path.dirname(mockFile)
        const base = path.basename(mockFile)
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        } catch (_) { /* ignore */ }
        const debugWatch = process.env.MEDDLE_DEBUG_WATCH === '1'
        const t0 = Date.now()
        const dbg = (msg: string) => { if (debugWatch) console.error(`[watch +${Date.now() - t0}ms] ${msg}`) }

        // Issue #123: when the mocks path is a symlink, edits land on the real
        // target (git pull in a dotfiles repo, fixing JSON there), so watch the
        // target's directory too and accept events for either path.
        const resolveTarget = (): string => {
            try { return resolveMocksWriteTarget(mockFile) } catch (_) { return path.resolve(mockFile) }
        }
        let target = resolveTarget()
        let targetDir: string | null = null

        // Watch the directory (not only the file) so atomic replace / recreate
        // still triggers — same pattern as route-rules watcher.
        const initialTargetDir = path.dirname(target)
        targetDir = path.resolve(initialTargetDir) !== path.resolve(dir) && fs.existsSync(initialTargetDir) ? initialTargetDir : null
        // Both directories go into the initial watch so they are ready together.
        const watcher = chokidar.watch(targetDir ? [dir, targetDir] : dir, {
            ignoreInitial: true,
            depth: 0,
            // Follow the symlink target explicitly (below) instead of relying on
            // chokidar's implicit following, which differs per platform backend.
            followSymlinks: false,
            awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
        })
        // Catch up on a write chokidar did not report because it landed while a
        // directory watch was still being set up (ignoreInitial).
        const catchUp = (why: string) => {
            if (closed || !watcherState || watcherState.file !== mockFile) return
            if (fileSig(mockFile) !== loadedSig) reload(why)
        }
        const watchTargetDir = () => {
            const want = path.dirname(target)
            const next = path.resolve(want) === path.resolve(dir) ? null : want
            if (next === targetDir) return
            if (targetDir) watcher.unwatch(targetDir)
            targetDir = next
            if (targetDir && fs.existsSync(targetDir)) {
                watcher.add(targetDir)
                // chokidar emits no 'ready' for add(); re-check a few times
                // while the new directory watch comes up.
                for (const ms of [100, 300, 1000]) {
                    setTimeout(() => catchUp('changed while target watch was starting'), ms).unref?.()
                }
            }
            dbg(`target ${target}; extra dir ${targetDir ?? '(none)'}`)
        }
        watchTargetDir()
        let closed = false
        let trailingCheck: ReturnType<typeof setTimeout> | null = null
        const reload = (event: string, changedPath?: string) => {
            // Ignore late events from a watcher that was replaced, and any
            // file in the directory other than the active mocks file / its target.
            if (closed || !watcherState || watcherState.file !== mockFile) return
            if (changedPath) {
                const p = path.resolve(changedPath)
                if (p !== path.resolve(mockFile) && p !== target) return
            }
            // The link itself may have been retargeted: follow the new target.
            const nextTarget = resolveTarget()
            if (nextTarget !== target) { target = nextTarget; watchTargetDir() }
            proxyDebug(`mocks file ${event}: ${base}`)
            loadMockRules()
            if (watcherOnReload) watcherOnReload()
            // Issue #116: chokidar throttles raw fs events per file on the
            // leading edge (5ms, no trailing emit), so a write landing right
            // after the one being handled (e.g. broken -> fixed a few ms apart,
            // especially while the watcher is still starting) can be dropped.
            // Re-check the file signature once the burst is over.
            if (trailingCheck) clearTimeout(trailingCheck)
            trailingCheck = setTimeout(() => { trailingCheck = null; catchUp('changed during a burst of writes') }, 150)
            trailingCheck.unref?.()
        }
        if (debugWatch) {
            watcher.on('all', (ev: string, p: string) => dbg(`${ev} ${p}`))
        }
        watcher.on('ready', () => {
            dbg('ready')
            catchUp('changed before watcher ready')
        })
        watcher.on('change', (p: string) => reload('changed', p))
        watcher.on('add', (p: string) => reload('added', p))
        watcher.on('unlink', (p: string) => reload('removed', p))
        watcherState = {
            file: mockFile,
            close: () => {
                closed = true
                if (trailingCheck) clearTimeout(trailingCheck)
                watcher.close().catch(() => { /* ignore */ })
            },
        }
        proxyDebug(`watching mocks file: ${mockFile}`)
    }

    /**
     * Watch the mocks file for external edits (CLI file-mode / hand edits).
     * Aligns with route-rules watcher so file-only writes still hot-reload (issue #85).
     * When the effective mocks file changes (issue #118), loadMockRules moves
     * the watcher to the new file automatically.
     */
    function initMockFileWatcher(onReload?: () => void): void {
        watcherOnReload = onReload
        startWatcher(getMockFilePath())
    }

    return {
        getMockFilePath, loadMockRules, saveMockRules, assertMocksWritable, getMocksParseError, matchMockRule,
        buildMockResponseForTest, sendMockResponse, loadCustomPathsFromSettings,
        initMockFileWatcher,
    }
}

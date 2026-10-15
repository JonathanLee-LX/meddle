import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { Request } from 'express'
import type { ServerContext } from './index'

/**
 * Issue #137: per-ruleset (rule file) read-only lock.
 *
 * - Stored in settings.json under `readonlyRuleFiles` (file names without
 *   `.txt`), never inside the rule file. A missing field means every ruleset
 *   is read-write, so old settings need no migration.
 * - Keyed by file name. A rename done outside Meddle makes a new, read-write
 *   ruleset; lock entries whose file no longer exists are dropped silently.
 * - Every ruleset write goes through `assertRuleFilesWritable`, which throws
 *   `RulesetReadonlyError` (code `RULESET_READONLY`).
 * - Only the web UI can lock / unlock: the request must carry the token the
 *   server put into the page (index.html meta / same-origin bootstrap) and pass
 *   a same-origin check. This guards against accidents, not against an attacker:
 *   anyone with a shell can GET the page, read the token, forge `Origin`, or
 *   simply edit the files on disk.
 */

export const RULESET_READONLY = 'RULESET_READONLY'
export const RULESET_READONLY_MESSAGE = '该规则集已设为只读，只能在 Meddle 界面中解锁'
/** HTTP status for a write against a locked ruleset (423 Locked). */
export const RULESET_READONLY_STATUS = 423
export const READONLY_SETTINGS_KEY = 'readonlyRuleFiles'

export const UI_TOKEN_HEADER = 'x-meddle-ui-token'
export const UI_TOKEN_META_NAME = 'meddle-ui-token'

export class RulesetReadonlyError extends Error {
    readonly code = RULESET_READONLY
    readonly status = RULESET_READONLY_STATUS
    constructor(readonly ruleFile: string) {
        super(RULESET_READONLY_MESSAGE)
        this.name = 'RulesetReadonlyError'
    }
}

export function isRulesetReadonlyError(err: unknown): err is RulesetReadonlyError {
    return err instanceof RulesetReadonlyError
}

export function rulesetReadonlyBody(err: RulesetReadonlyError): { error: string; code: string; ruleFile: string } {
    return { error: err.message, code: err.code, ruleFile: err.ruleFile }
}

function readSettings(ctx: ServerContext): Record<string, unknown> {
    try {
        if (fs.existsSync(ctx.settingsPath)) {
            return JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'))
        }
    } catch { /* ignore */ }
    return {}
}

function writeSettings(ctx: ServerContext, settings: Record<string, unknown>): void {
    const dir = path.dirname(ctx.settingsPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(ctx.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

/** Normalize the raw settings value; anything that is not a string array counts as empty. */
export function normalizeReadonlyNames(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const names: string[] = []
    for (const item of value) {
        if (typeof item !== 'string' || !item || seen.has(item)) continue
        seen.add(item)
        names.push(item)
    }
    return names
}

function ruleFileExists(ctx: ServerContext, name: string): boolean {
    return fs.existsSync(path.join(ctx.meddleDir, 'route-rules', `${name}.txt`))
}

/**
 * Locked rule file names. Entries whose file is gone (deleted or renamed
 * outside Meddle) are removed from settings.json here, silently.
 */
export function getReadonlyRuleFileNames(ctx: ServerContext): string[] {
    const settings = readSettings(ctx)
    if (!(READONLY_SETTINGS_KEY in settings)) return []
    const stored = normalizeReadonlyNames(settings[READONLY_SETTINGS_KEY])
    const live = stored.filter((name) => ruleFileExists(ctx, name))
    const raw = settings[READONLY_SETTINGS_KEY]
    const changed = !Array.isArray(raw) || live.length !== raw.length
    if (changed) {
        settings[READONLY_SETTINGS_KEY] = live
        writeSettings(ctx, settings)
    }
    return live
}

export function isRuleFileReadonly(ctx: ServerContext, name: string): boolean {
    return getReadonlyRuleFileNames(ctx).some((item) => fold(item) === fold(name))
}

/**
 * File names compare case-insensitively on macOS / Windows, where `Foo.txt`
 * and `foo.txt` are the same file; the lock must not be dodged by changing case.
 */
const CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32'
const fold = (name: string) => (CASE_INSENSITIVE_FS ? name.toLowerCase() : name)

/** The common write gate: throws RulesetReadonlyError for the first locked name. */
export function assertRuleFilesWritable(ctx: ServerContext, names: Iterable<string>): void {
    const locked = getReadonlyRuleFileNames(ctx)
    if (locked.length === 0) return
    const byKey = new Map(locked.map((name) => [fold(name), name]))
    for (const name of names) {
        const hit = byKey.get(fold(name))
        if (hit !== undefined) throw new RulesetReadonlyError(hit)
    }
}

export function assertRuleFileWritable(ctx: ServerContext, name: string): void {
    assertRuleFilesWritable(ctx, [name])
}

/** Lock / unlock. Only the token-protected UI route calls this. */
export function setRuleFileReadonly(ctx: ServerContext, name: string, readonly: boolean): string[] {
    if (!ruleFileExists(ctx, name)) {
        throw new Error('规则文件不存在')
    }
    const current = getReadonlyRuleFileNames(ctx)
    const next = readonly
        ? (current.includes(name) ? current : [...current, name])
        : current.filter((item) => item !== name)
    const settings = readSettings(ctx)
    settings[READONLY_SETTINGS_KEY] = next
    writeSettings(ctx, settings)
    return next
}

// ---------- UI token + same-origin check ----------

const uiTokens = new WeakMap<object, string>()

/** One random token per server instance; handed to the page, never to CLI/MCP. */
export function getUiToken(ctx: ServerContext): string {
    let token = uiTokens.get(ctx)
    if (!token) {
        token = crypto.randomBytes(32).toString('hex')
        uiTokens.set(ctx, token)
    }
    return token
}

/** Put the token into index.html as `<meta name="meddle-ui-token">`. */
export function injectUiToken(html: string, token: string): string {
    const meta = `<meta name="${UI_TOKEN_META_NAME}" content="${token}">`
    if (html.includes('</head>')) return html.replace('</head>', `${meta}</head>`)
    return meta + html
}

function headerValue(req: Request, name: string): string {
    const value = req.headers[name]
    if (Array.isArray(value)) return value[0] || ''
    return typeof value === 'string' ? value : ''
}

/**
 * Same-origin check. Browsers send `Sec-Fetch-Site`; when present it must be
 * `same-origin`. When `Origin` is present its host must equal `Host`. A request
 * with neither header (plain curl / CLI / MCP fetch) is rejected.
 */
export function isSameOriginRequest(req: Request): boolean {
    const site = headerValue(req, 'sec-fetch-site')
    const origin = headerValue(req, 'origin')
    if (!site && !origin) return false
    if (site && site !== 'same-origin') return false
    if (origin) {
        const host = headerValue(req, 'host')
        try {
            if (!host || new URL(origin).host !== host) return false
        } catch {
            return false
        }
    }
    return true
}

export function hasValidUiToken(req: Request, ctx: ServerContext): boolean {
    const provided = headerValue(req, UI_TOKEN_HEADER)
    const expected = getUiToken(ctx)
    if (!provided || provided.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

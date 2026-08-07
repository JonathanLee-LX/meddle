/**
 * meddle crash-report — crash dump collection with fingerprinting and dedupe.
 *
 * Pure JS so it runs unmodified in the npm package and in the deno-compiled
 * binary (bin/ is bundled at compile time). Never throws: the crash reporter
 * must not crash while reporting a crash.
 *
 * Layout: <home>/crash/<fingerprint>-<timestamp>.json
 *
 * Privacy: only env KEY names are recorded, never their values; request
 * headers/URLs are scrubbed of common credential patterns before writing.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const CRASH_DIR = 'crash'
const MAX_FILES_PER_FINGERPRINT = 10

const SENSITIVE_HEADER_PATTERNS = [
    /authorization/i,
    /cookie/i,
    /set-cookie/i,
    /token/i,
    /session/i,
    /x-api-key/i,
]

const SENSITIVE_QUERY_PATTERNS = [
    /token=/i,
    /key=/i,
    /secret=/i,
    /password=/i,
    /apikey=/i,
    /appid=/i,
    /app_id=/i,
]

/**
 * Normalize a stack frame into a stable token:
 *   - file:///.../dist/core/h2-pool.js:182:30 → h2-pool.js
 *   - ext:deno_node/net.ts:1:21858 → net.ts
 *   - node:internal/timers.mjs:4:1174 → internal/timers.mjs
 *   - (file:///x/dist/a.js:10:20) → a.js
 * Line/column numbers and volatile absolute paths are stripped so identical
 * crashes (different addresses/timestamps) share one fingerprint.
 */
function normalizeFrame(frame) {
    const line = frame.trim()
    const match = line.match(/\(?(?:file:\/\/)?[^)\s]*[\\/]([^\\/)\s:]+\.(?:js|ts|mjs|cjs))(?::\d+:\d+)?\)?/)
    if (match) return match[1]
    // bare frames like "at f (a.js:10:20)" or "at TCPWrap.onStreamRead"
    const bare = line.match(/at\s+([\w.]+)(?:\s*\(.*\))?$/)
    if (bare) return bare[1]
    return line.slice(0, 80)
}

/**
 * Build a stable fingerprint for an error. Prefers the error `code` when
 * present (e.g. ECONNRESET); otherwise the first stack frame chain is
 * normalized to remove addresses, paths and line numbers.
 * @param {Error & { code?: string }} err
 * @returns {string}
 */
function crashFingerprint(err) {
    if (err && typeof err.code === 'string' && err.code) return err.code
    if (err && typeof err.stack === 'string') {
        const lines = err.stack.split('\n').slice(0, 5)
        const frames = lines.map(normalizeFrame).filter(Boolean)
        if (frames.length > 0) return frames.join('|').slice(0, 120)
    }
    if (err && err.message) return String(err.message).slice(0, 120)
    return 'unknown'
}

/**
 * Strip credential-shaped values from a free-form object (headers, URL query).
 * Returns a new object with sensitive keys replaced by a marker.
 */
function scrubSensitive(input) {
    if (!input || typeof input !== 'object') return input
    const out = {}
    for (const [key, value] of Object.entries(input)) {
        const k = String(key)
        const isSensitiveHeader = SENSITIVE_HEADER_PATTERNS.some(p => p.test(k))
        const isSensitiveQuery = SENSITIVE_QUERY_PATTERNS.some(p => p.test(k))
        if (isSensitiveHeader || isSensitiveQuery) {
            out[k] = '[redacted]'
        } else {
            out[k] = value
        }
    }
    return out
}

/**
 * Sanitize crash context before it is written to disk.
 * Only env key names are kept (never values); request metadata is scrubbed.
 * @param {{ envKeys?: string[], requestUrl?: string, headers?: Record<string, string> }} input
 * @returns {Record<string, unknown>}
 */
function sanitizeCrashData(input) {
    const out = {}
    if (Array.isArray(input.envKeys)) {
        out.envKeys = input.envKeys.filter(k => typeof k === 'string')
    }
    if (typeof input.requestUrl === 'string') {
        try {
            const u = new URL(input.requestUrl)
            out.requestUrl = u.origin + u.pathname
            if (u.search) {
                const params = new URLSearchParams(u.search)
                const scrubbed = {}
                for (const [k, v] of params) {
                    scrubbed[k] = SENSITIVE_QUERY_PATTERNS.some(p => p.test(k + '=')) ? '[redacted]' : v
                }
                out.requestQuery = scrubbed
            }
        } catch (_) {
            out.requestUrl = '[invalid-url]'
        }
    }
    if (input.headers && typeof input.headers === 'object') {
        out.headers = scrubSensitive(input.headers)
    }
    return out
}

/**
 * Record a crash dump to <home>/crash/<fingerprint>-<ts>.json.
 * Dedupes by fingerprint (max MAX_FILES_PER_FINGERPRINT). Never throws.
 * @param {{ home: string, error: Error, version?: string, platform?: string,
 *           envKeys?: string[], requestUrl?: string, headers?: Record<string, string>,
 *           context?: Record<string, unknown>, now?: number }} opts
 * @returns {string} the written file path (or '' when the write failed)
 */
function recordCrash(opts) {
    try {
        const home = opts.home
        const error = opts.error || new Error('unknown')
        const now = opts.now !== undefined ? opts.now : Date.now()
        const fingerprint = crashFingerprint(error)
        const crashDir = path.join(home, CRASH_DIR)
        fs.mkdirSync(crashDir, { recursive: true })

        // Dedupe: evict oldest files of the same fingerprint beyond the cap.
        const existing = fs.readdirSync(crashDir)
            .filter(f => f.startsWith(fingerprint + '-'))
            .sort()
        while (existing.length >= MAX_FILES_PER_FINGERPRINT) {
            const oldest = existing.shift()
            if (oldest) {
                try { fs.unlinkSync(path.join(crashDir, oldest)) } catch (_) {}
            }
        }

        const sanitized = sanitizeCrashData({
            envKeys: opts.envKeys,
            requestUrl: opts.requestUrl,
            headers: opts.headers,
        })

        const data = {
            fingerprint,
            timestamp: now,
            version: opts.version || '',
            platform: opts.platform || `${os.platform()}-${os.arch()}`,
            error: {
                name: error.name || 'Error',
                message: error.message || String(error),
                stack: typeof error.stack === 'string' ? error.stack : String(error),
            },
            ...sanitized,
            context: opts.context || {},
        }

        const file = path.join(crashDir, `${fingerprint}-${now}.json`)
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
        return file
    } catch (_) {
        return ''
    }
}

module.exports = {
    crashFingerprint,
    sanitizeCrashData,
    recordCrash,
    CRASH_DIR,
    MAX_FILES_PER_FINGERPRINT,
}

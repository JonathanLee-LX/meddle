/**
 * Shared helpers for mock URL/query matching and response header placeholders.
 */

/** Extract the query string (without leading `?`) from a full or path-only URL. */
export function extractUrlSearch(url: string): string {
    if (!url) return ''
    const q = url.indexOf('?')
    if (q === -1) return ''
    const hash = url.indexOf('#', q)
    return hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash)
}

/** Match urlPattern as RegExp, falling back to substring includes on invalid regex. */
export function matchUrlPattern(url: string, pattern: string): boolean {
    if (!pattern) return false
    try {
        return new RegExp(pattern).test(url)
    } catch {
        return url.includes(pattern)
    }
}

/**
 * Optional query condition: every `&`-separated token must match an exact
 * `key=value` parameter in the URL search (URLSearchParams / `&`-boundary
 * semantics). Example: `window_key=A` matches `?window_key=A&x=1` but not
 * `?window_key=AB`. Multi-token `a=1&b=2` requires all pairs.
 * Empty/undefined query matches any request.
 */
export function matchQueryCondition(url: string, query?: string | null): boolean {
    if (query == null || query === '') return true
    const tokens = String(query).split('&').map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 0) return true

    const actual = new URLSearchParams(extractUrlSearch(url))
    return tokens.every((token) => {
        const eq = token.indexOf('=')
        if (eq === -1) {
            // Bare key: require the parameter to be present (any value).
            return actual.has(token)
        }
        // Parse via URLSearchParams so encoding/decoding stays consistent.
        const entries = [...new URLSearchParams(token).entries()]
        if (entries.length === 0) return false
        return entries.every(([key, value]) => actual.getAll(key).includes(value))
    })
}

/** Read Origin from request headers (case-insensitive). Falls back to `*`. */
export function getRequestOrigin(headers?: Record<string, any> | null): string {
    if (!headers || typeof headers !== 'object') return '*'
    const origin = headers.origin ?? headers.Origin
    if (Array.isArray(origin)) {
        const first = origin.find((v) => typeof v === 'string' && v.trim())
        return first ? String(first).trim() : '*'
    }
    if (typeof origin === 'string' && origin.trim()) return origin.trim()
    return '*'
}

/** Credentials-friendly CORS header template (Origin echoed via `{origin}`). */
export function corsCredentialHeaders(): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': '{origin}',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
    }
}

/**
 * Resolve `{origin}` placeholders in header values using the request Origin.
 * Placeholder match is case-insensitive.
 */
export function resolveHeaderPlaceholders(
    headers: Record<string, string>,
    requestHeaders?: Record<string, any> | null,
): Record<string, string> {
    const origin = getRequestOrigin(requestHeaders)
    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers || {})) {
        resolved[key] = typeof value === 'string'
            ? value.replace(/\{origin\}/gi, origin)
            : String(value ?? '')
    }
    return resolved
}

/**
 * Merge header maps case-insensitively: later entries win and replace any
 * existing key that matches ignoring case (avoids duplicate ACAO * + {origin}).
 */
export function mergeResponseHeaders(
    ...layers: Array<Record<string, string> | null | undefined>
): Record<string, string> {
    const out: Record<string, string> = {}
    for (const layer of layers) {
        if (!layer) continue
        for (const [key, value] of Object.entries(layer)) {
            const lower = key.toLowerCase()
            for (const existing of Object.keys(out)) {
                if (existing.toLowerCase() === lower) delete out[existing]
            }
            out[key] = value
        }
    }
    return out
}

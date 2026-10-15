/**
 * The Meddle version comes from the backend (`GET /api/version`), which reads
 * the root package.json — the same source as `meddle --version`. The web
 * package's own version is private/unrelated and must not be shown.
 *
 * Issue #139: the same response also carries the route-rules directory the
 * server actually uses (follows MEDDLE_HOME), so no extra request is needed.
 */
export interface AppInfo {
  version: string | null
  /** Absolute route-rules directory, e.g. `/Users/me/.meddle/route-rules`. */
  routeRulesDir: string | null
  /** Display form from the server, e.g. `~/.meddle/route-rules/`. */
  routeRulesDirDisplay: string | null
}

const EMPTY_APP_INFO: AppInfo = { version: null, routeRulesDir: null, routeRulesDirDisplay: null }

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v || null
}

export function parseAppInfo(data: unknown): AppInfo {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY_APP_INFO }
  const r = data as Record<string, unknown>
  return {
    version: nonEmptyString(r.version),
    routeRulesDir: nonEmptyString(r.routeRulesDir),
    routeRulesDirDisplay: nonEmptyString(r.routeRulesDirDisplay),
  }
}

export async function fetchAppInfo(): Promise<AppInfo> {
  try {
    const res = await fetch('/api/version')
    if (!res.ok) return { ...EMPTY_APP_INFO }
    return parseAppInfo(await res.json())
  } catch {
    return { ...EMPTY_APP_INFO }
  }
}

export async function fetchAppVersion(): Promise<string | null> {
  return (await fetchAppInfo()).version
}

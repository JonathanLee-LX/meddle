/**
 * Issue #137: the page token that lets this UI (and only this UI) lock or
 * unlock a ruleset. The server puts it into index.html as
 * `<meta name="meddle-ui-token">`; when the page was not served by Meddle
 * (Vite dev) or the server restarted, it is fetched from the same-origin-only
 * `/api/ui-token` bootstrap.
 *
 * This is an anti-accident guard for agents using the CLI / MCP, not a
 * security boundary: anything with a shell can read the page and forge Origin.
 */

export const UI_TOKEN_HEADER = 'X-Meddle-UI-Token'
const META_NAME = 'meddle-ui-token'

let cachedToken: string | null = null

function readPageToken(): string | null {
  if (typeof document === 'undefined') return null
  const value = document.querySelector(`meta[name="${META_NAME}"]`)?.getAttribute('content')
  return value && value.trim() ? value.trim() : null
}

async function fetchBootstrapToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/ui-token', { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: unknown }
    return typeof data.token === 'string' && data.token ? data.token : null
  } catch {
    return null
  }
}

export async function getUiToken(refresh = false): Promise<string | null> {
  if (!refresh) {
    cachedToken = cachedToken || readPageToken()
    if (cachedToken) return cachedToken
  }
  cachedToken = await fetchBootstrapToken()
  return cachedToken
}

/** Test hook: forget the cached token. */
export function resetUiTokenCache(): void {
  cachedToken = null
}

export interface ReadonlyToggleResult {
  success: boolean
  error?: string
}

/** PUT /api/rule-files/:name/readonly with the page token; retries once with a fresh token. */
export async function putRuleFileReadonly(name: string, readonly: boolean): Promise<ReadonlyToggleResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getUiToken(attempt > 0)
    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}/readonly`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(token ? { [UI_TOKEN_HEADER]: token } : {}) },
        body: JSON.stringify({ readonly }),
      })
      const data = (await res.json().catch(() => null)) as { status?: string; error?: string; code?: string } | null
      if (res.ok && data?.status === 'success') return { success: true }
      if (res.status === 403 && data?.code === 'UI_TOKEN_INVALID' && attempt === 0) continue
      return { success: false, error: data?.error || `保存失败（${res.status}）` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '保存失败' }
    }
  }
  return { success: false, error: '保存失败' }
}

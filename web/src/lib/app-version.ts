/**
 * The Meddle version comes from the backend (`GET /api/version`), which reads
 * the root package.json — the same source as `meddle --version`. The web
 * package's own version is private/unrelated and must not be shown.
 */
export async function fetchAppVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/version')
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (data && typeof data === 'object' && typeof (data as { version?: unknown }).version === 'string') {
      const version = (data as { version: string }).version.trim()
      return version || null
    }
    return null
  } catch {
    return null
  }
}

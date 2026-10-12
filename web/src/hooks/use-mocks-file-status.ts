import { useCallback, useEffect, useState } from 'react'

/** Status of the mocks file the proxy currently uses (GET /api/mocks-file, issue #118). */
export interface MocksFileStatus {
  path: string
  exists: boolean
  /** A custom mocksFilePath is in effect (not the default <MEDDLE_HOME>/mocks.json). */
  custom: boolean
}

/**
 * Show the missing-file notice only for a custom path that does not exist yet.
 * A default mocks.json that has not been created is normal and stays silent.
 */
export function shouldShowMocksFileMissing(status: MocksFileStatus | null): status is MocksFileStatus {
  return !!status && status.custom && !status.exists
}

const MOCKS_UPDATED_EVENT = 'mocksUpdated'

export function parseMocksFileStatus(data: unknown): MocksFileStatus | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { path, exists, custom } = data as Record<string, unknown>
  if (typeof path !== 'string' || typeof exists !== 'boolean') return null
  // Older servers without `custom`: treat as default so no notice is shown.
  return { path, exists, custom: custom === true }
}

/**
 * Tracks whether the active mocks file exists. Re-checks whenever `refreshKey`
 * changes and whenever the server broadcasts a mock change (path switch,
 * first save creating the file, external edits).
 */
export function useMocksFileStatus(refreshKey?: unknown) {
  const [status, setStatus] = useState<MocksFileStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/mocks-file', { cache: 'no-store' })
      if (!res.ok) return
      setStatus(parseMocksFileStatus(await res.json()))
    } catch {
      // Older server / offline: keep the last known status, show no notice.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch on mount / refreshKey change
    void refresh()
  }, [refresh, refreshKey])

  useEffect(() => {
    const handler = () => { void refresh() }
    window.addEventListener(MOCKS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(MOCKS_UPDATED_EVENT, handler)
  }, [refresh])

  return { status, refresh }
}

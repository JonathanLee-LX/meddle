import { useCallback, useEffect, useState } from 'react'

/** Status of the mocks file the proxy currently uses (GET /api/mocks-file, issue #118). */
export interface MocksFileStatus {
  path: string
  exists: boolean
}

const MOCKS_UPDATED_EVENT = 'mocksUpdated'

/** Notice shown when the configured mocks file does not exist yet. */
export function mocksFileMissingNotice(path: string): string {
  return `文件不存在：${path}，保存第一条规则时会创建`
}

export function parseMocksFileStatus(data: unknown): MocksFileStatus | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { path, exists } = data as Record<string, unknown>
  if (typeof path !== 'string' || typeof exists !== 'boolean') return null
  return { path, exists }
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

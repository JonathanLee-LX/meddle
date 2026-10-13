import { useCallback, useEffect, useState } from 'react'

/** Status of the mocks file the proxy currently uses (GET /api/mocks-file, issue #118). */
export interface MocksFileStatus {
  path: string
  exists: boolean
  /** A custom mocksFilePath is in effect (not the default <MEDDLE_HOME>/mocks.json). */
  custom: boolean
  /** Issue #120: false when the file exists but failed to parse; the server refuses every write. */
  valid: boolean
  /** Parse failure position reported by the server (single source; never parsed in the browser). */
  parseError: MocksParseError | null
  /** Issue #121: relative path that only exists under the old (start-directory) rule. */
  legacyMocksPath?: LegacyMocksPath | null
}

export interface LegacyMocksPath {
  configured: string
  oldPath: string
  newPath: string
}

export interface MocksParseError {
  line: number | null
  column: number | null
  message: string
}

/** Server reported the active mocks file as unparseable (issue #120). */
export function isMocksFileInvalid(status: MocksFileStatus | null): status is MocksFileStatus & { parseError: MocksParseError } {
  return !!status && status.valid === false && !!status.parseError
}

/** 「第 12 行第 5 列：Unexpected token }」 */
export function formatMocksParseLocation(err: MocksParseError): string {
  return err.line != null ? `第 ${err.line} 行第 ${err.column} 列：${err.message}` : err.message
}

/**
 * Show the missing-file notice only for a custom path that does not exist yet.
 * A default mocks.json that has not been created is normal and stays silent.
 */
export function shouldShowMocksFileMissing(status: MocksFileStatus | null): status is MocksFileStatus {
  return !!status && status.custom && !status.exists
}

const MOCKS_UPDATED_EVENT = 'mocksUpdated'
/** Fired by use-mocks when a write was refused (issue #120). */
export const MOCKS_FILE_STATUS_CHANGED_EVENT = 'mocksFileStatusChanged'

export function parseMocksFileStatus(data: unknown): MocksFileStatus | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { path, exists, custom, valid, parseError, legacyMocksPath } = data as Record<string, unknown>
  if (typeof path !== 'string' || typeof exists !== 'boolean') return null
  let pe: MocksParseError | null = null
  if (valid === false && parseError && typeof parseError === 'object') {
    const r = parseError as Record<string, unknown>
    pe = {
      line: typeof r.line === 'number' ? r.line : null,
      column: typeof r.column === 'number' ? r.column : null,
      message: typeof r.message === 'string' ? r.message : '',
    }
  }
  // Older servers without `custom` / `valid`: treat as default + valid.
  let legacy: LegacyMocksPath | null = null
  if (legacyMocksPath && typeof legacyMocksPath === 'object') {
    const l = legacyMocksPath as Record<string, unknown>
    if (typeof l.oldPath === 'string' && typeof l.newPath === 'string') {
      legacy = { configured: typeof l.configured === 'string' ? l.configured : '', oldPath: l.oldPath, newPath: l.newPath }
    }
  }
  return { path, exists, custom: custom === true, valid: !pe, parseError: pe, legacyMocksPath: legacy }
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
    window.addEventListener(MOCKS_FILE_STATUS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener(MOCKS_UPDATED_EVENT, handler)
      window.removeEventListener(MOCKS_FILE_STATUS_CHANGED_EVENT, handler)
    }
  }, [refresh])

  return { status, refresh }
}

/** True when the typed mocks path is relative (not empty, not absolute, not ~). */
export function isRelativeMocksPathInput(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('/') || v.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(v)) return false
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\')) return false
  return true
}


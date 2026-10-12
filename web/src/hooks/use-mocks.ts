import { toast } from '@/components/ui/toast'
import { MOCKS_FILE_STATUS_CHANGED_EVENT } from '@/hooks/use-mocks-file-status'
import { useState, useCallback, useEffect } from 'react'
import type { MockRule } from '@/types'

const MOCKS_UPDATED_EVENT = 'mocksUpdated'

/**
 * Issue #120: the server refused a write because the mocks file is not valid
 * JSON. Show its message (full path + line/column) and make the file-status
 * hook re-fetch so the list / button switch to the error state (stale tab).
 */
/** Issue #123: the editor shows its own inline notice, so it asks for no toast. */
export interface MockWriteOptions { silentInvalid?: boolean }

let lastWriteRefusedInvalid = false
/**
 * Issue #123: true when the most recent create/update was refused with 409
 * MOCKS_FILE_INVALID. The editor uses it to show its inline notice instead of
 * a generic error / toast. Reading it resets it.
 */
export function consumeMocksWriteRefusedInvalid(): boolean {
  const v = lastWriteRefusedInvalid
  lastWriteRefusedInvalid = false
  return v
}

function reportInvalidMocksFile(data: unknown, opts: { silent?: boolean } = {}): void {
  const d = data as { code?: string; error?: string } | null
  if (d?.code !== 'MOCKS_FILE_INVALID') return
  lastWriteRefusedInvalid = true
  if (!opts.silent) toast.error(d.error || 'Mock 文件格式错误')
  window.dispatchEvent(new CustomEvent(MOCKS_FILE_STATUS_CHANGED_EVENT))
}

export function dedupeMockRules(rules: MockRule[]): MockRule[] {
  const byId = new Map<number, MockRule>()
  for (const rule of rules) {
    byId.set(rule.id, rule)
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id)
}

export function upsertMockRule(rules: MockRule[], nextRule: MockRule): MockRule[] {
  return dedupeMockRules([...rules.filter((rule) => rule.id !== nextRule.id), nextRule])
}

/**
 * Hook for managing mock rules
 */
export function useMocks() {
  const [mockRules, setMockRules] = useState<MockRule[]>([])

  const fetchMocks = useCallback(async () => {
    try {
      const res = await fetch('/api/mocks', { cache: 'no-store' })
      const data = await res.json()
      setMockRules(dedupeMockRules(Array.isArray(data) ? data : []))
    } catch (err) {
      console.error('Failed to fetch mocks:', err)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch on mount
    void fetchMocks()
  }, [fetchMocks])

  // 监听服务端广播的 Mock 规则变更（如通过 MCP/API 修改后）
  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<MockRule[] | undefined>
      setMockRules(dedupeMockRules(Array.isArray(e.detail) ? e.detail : []))
    }
    window.addEventListener(MOCKS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(MOCKS_UPDATED_EVENT, handler)
  }, [])

  const createMock = useCallback(async (rule: Omit<MockRule, 'id'>, opts?: MockWriteOptions) => {
    try {
      const res = await fetch('/api/mocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setMockRules((prev) => upsertMockRule(prev, data.rule as MockRule))
        return data.rule as MockRule
      }
      reportInvalidMocksFile(data, { silent: opts?.silentInvalid })
      return null
    } catch (err) {
      console.error('Failed to create mock:', err)
      return null
    }
  }, [])

  const updateMock = useCallback(async (id: number, updates: Partial<MockRule>, opts?: MockWriteOptions) => {
    let previous: MockRule | undefined
    setMockRules((prev) => {
      previous = prev.find((rule) => rule.id === id)
      if (!previous) return prev
      return upsertMockRule(prev, { ...previous, ...updates })
    })

    try {
      const res = await fetch(`/api/mocks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setMockRules((prev) => upsertMockRule(prev, data.rule as MockRule))
        return true
      }
      reportInvalidMocksFile(data, { silent: opts?.silentInvalid })
      if (previous) {
        const rollback = previous
        setMockRules((prev) => upsertMockRule(prev, rollback))
      }
      return false
    } catch (err) {
      console.error('Failed to update mock:', err)
      if (previous) {
        const rollback = previous
        setMockRules((prev) => upsertMockRule(prev, rollback))
      }
      return false
    }
  }, [])

  const deleteMock = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/mocks/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') {
        setMockRules((prev) => prev.filter((r) => r.id !== id))
        return true
      }
      reportInvalidMocksFile(data)
      return false
    } catch (err) {
      console.error('Failed to delete mock:', err)
      return false
    }
  }, [])

  return {
    mockRules,
    fetchMocks,
    createMock,
    updateMock,
    deleteMock,
  }
}

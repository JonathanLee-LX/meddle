import type { ProxyRecord } from '@/types'

export const DEFAULT_MAX_LOG_RECORDS = 10_000
export const LOG_BATCH_INTERVAL_MS = 50

/**
 * Pending WebSocket records arrive oldest-to-newest. The UI stores records
 * newest-first, so reverse the batch while copying it into one bounded array.
 */
export function prependLogBatch(
  current: ProxyRecord[],
  pending: ProxyRecord[],
  maxRecords: number,
): ProxyRecord[] {
  if (pending.length === 0) return current

  const limit = Math.max(0, maxRecords)
  if (limit === 0) return []

  const pendingCount = Math.min(pending.length, limit)
  const currentCount = Math.min(current.length, limit - pendingCount)
  const next = new Array<ProxyRecord>(pendingCount + currentCount)

  for (let index = 0; index < pendingCount; index++) {
    next[index] = pending[pending.length - 1 - index]
  }
  for (let index = 0; index < currentCount; index++) {
    next[pendingCount + index] = current[index]
  }

  return next
}

/**
 * Initial HTTP history can race with live WebSocket messages. Keep live
 * records first and append only unseen history records.
 */
export function mergeLogHistory(
  current: ProxyRecord[],
  history: ProxyRecord[],
  maxRecords: number,
): ProxyRecord[] {
  const limit = Math.max(0, maxRecords)
  if (limit === 0) return []
  if (current.length === 0) {
    return history.length <= limit ? history : history.slice(0, limit)
  }

  const merged: ProxyRecord[] = []
  const seenIds = new Set<number>()

  const append = (record: ProxyRecord) => {
    if (merged.length >= limit) return
    if (typeof record.id === 'number') {
      if (seenIds.has(record.id)) return
      seenIds.add(record.id)
    }
    merged.push(record)
  }

  for (const record of current) append(record)
  for (const record of history) append(record)
  return merged
}

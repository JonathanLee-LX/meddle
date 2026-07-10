import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_LOG_RECORDS, mergeLogHistory, prependLogBatch } from './log-records'
import type { ProxyRecord } from '@/types'

function record(id: number): ProxyRecord {
  return {
    id,
    method: 'GET',
    source: `https://example.com/${id}`,
    target: 'http://localhost:3000',
    time: '10:00:00',
  }
}

describe('log record buffering', () => {
  it('raises the UI retention limit to ten thousand records', () => {
    expect(DEFAULT_MAX_LOG_RECORDS).toBe(10_000)
  })

  it('prepends a chronological batch in newest-first order', () => {
    const result = prependLogBatch(
      [record(2), record(1)],
      [record(3), record(4), record(5)],
      10,
    )

    expect(result.map((item) => item.id)).toEqual([5, 4, 3, 2, 1])
  })

  it('retains only the newest records when the limit is exceeded', () => {
    const result = prependLogBatch(
      [record(3), record(2), record(1)],
      [record(4), record(5), record(6)],
      4,
    )

    expect(result.map((item) => item.id)).toEqual([6, 5, 4, 3])
  })

  it('merges initial history without overwriting or duplicating live records', () => {
    const result = mergeLogHistory(
      [record(5), record(4)],
      [record(4), record(3), record(2), record(1)],
      10,
    )

    expect(result.map((item) => item.id)).toEqual([5, 4, 3, 2, 1])
  })
})

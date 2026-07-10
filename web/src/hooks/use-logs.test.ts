import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOG_BATCH_INTERVAL_MS } from '@/lib/log-records'
import { useLogs } from './use-logs'

type Listener = (event: MessageEvent) => void

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly url: string
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emitMessage(data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get('message') || []) listener(event)
  }

  close() {}
}

describe('useLogs batching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([]),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('commits WebSocket records once per batch window in newest-first order', async () => {
    const { result, unmount } = renderHook(() => useLogs(10_000))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const socket = MockWebSocket.instances[0]
    expect(socket.url).toContain('/ws')

    act(() => {
      socket.emitMessage({ id: 1, method: 'GET', source: 'a', target: 'b', time: '1' })
      socket.emitMessage({ id: 2, method: 'GET', source: 'a', target: 'b', time: '2' })
      socket.emitMessage({ id: 3, method: 'GET', source: 'a', target: 'b', time: '3' })
    })

    expect(result.current.records).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(LOG_BATCH_INTERVAL_MS)
    })

    expect(result.current.records.map((record) => record.id)).toEqual([3, 2, 1])
    unmount()
  })

  it('enforces the configured capacity when a batch is flushed', () => {
    const { result, unmount } = renderHook(() => useLogs(2))
    const socket = MockWebSocket.instances[0]

    act(() => {
      socket.emitMessage({ id: 1, method: 'GET', source: 'a', target: 'b', time: '1' })
      socket.emitMessage({ id: 2, method: 'GET', source: 'a', target: 'b', time: '2' })
      socket.emitMessage({ id: 3, method: 'GET', source: 'a', target: 'b', time: '3' })
      vi.advanceTimersByTime(LOG_BATCH_INTERVAL_MS)
    })

    expect(result.current.records.map((record) => record.id)).toEqual([3, 2])
    unmount()
  })
})

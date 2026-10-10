import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackendHeartbeat } from './use-backend-heartbeat'

describe('useBackendHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stays silent after a single failed probe', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() =>
      useBackendHeartbeat({
        fetchImpl,
        intervalMs: 1000,
        failureThreshold: 3,
        timeoutMs: 500,
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.unreachable).toBe(false)
    expect(result.current.consecutiveFailures).toBe(1)
  })

  it('shows unreachable after consecutive failure threshold', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() =>
      useBackendHeartbeat({
        fetchImpl,
        intervalMs: 1000,
        failureThreshold: 3,
        timeoutMs: 500,
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.consecutiveFailures).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })
    expect(result.current.consecutiveFailures).toBe(2)
    expect(result.current.unreachable).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })
    expect(result.current.consecutiveFailures).toBe(3)
    expect(result.current.unreachable).toBe(true)
  })

  it('clears unreachable on the next successful probe without remount', async () => {
    let fail = true
    const fetchImpl = vi.fn().mockImplementation(async () => {
      if (fail) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200 }
    })

    const { result } = renderHook(() =>
      useBackendHeartbeat({
        fetchImpl,
        intervalMs: 1000,
        failureThreshold: 2,
        timeoutMs: 500,
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })
    expect(result.current.unreachable).toBe(true)

    fail = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })
    expect(result.current.unreachable).toBe(false)
    expect(result.current.consecutiveFailures).toBe(0)
  })
})

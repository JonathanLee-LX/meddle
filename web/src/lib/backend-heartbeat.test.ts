import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKEND_HEARTBEAT_FAILURE_THRESHOLD,
  BACKEND_HEARTBEAT_PATH,
  initialHeartbeatState,
  probeBackendReachability,
  reduceHeartbeatProbe,
} from './backend-heartbeat'

describe('reduceHeartbeatProbe', () => {
  it('does not show banner after a single failure (debounce blip)', () => {
    const next = reduceHeartbeatProbe(initialHeartbeatState(), false)
    expect(next.consecutiveFailures).toBe(1)
    expect(next.unreachable).toBe(false)
  })

  it('shows banner only after N consecutive failures', () => {
    let state = initialHeartbeatState()
    for (let i = 1; i < BACKEND_HEARTBEAT_FAILURE_THRESHOLD; i++) {
      state = reduceHeartbeatProbe(state, false)
      expect(state.unreachable).toBe(false)
      expect(state.consecutiveFailures).toBe(i)
    }
    state = reduceHeartbeatProbe(state, false)
    expect(state.consecutiveFailures).toBe(BACKEND_HEARTBEAT_FAILURE_THRESHOLD)
    expect(state.unreachable).toBe(true)
  })

  it('clears banner on the next successful probe', () => {
    let state = initialHeartbeatState()
    for (let i = 0; i < BACKEND_HEARTBEAT_FAILURE_THRESHOLD; i++) {
      state = reduceHeartbeatProbe(state, false)
    }
    expect(state.unreachable).toBe(true)

    state = reduceHeartbeatProbe(state, true)
    expect(state).toEqual({ consecutiveFailures: 0, unreachable: false })
  })

  it('resets the failure streak when a success interrupts failures', () => {
    let state = initialHeartbeatState()
    state = reduceHeartbeatProbe(state, false)
    state = reduceHeartbeatProbe(state, false)
    state = reduceHeartbeatProbe(state, true)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.unreachable).toBe(false)
    state = reduceHeartbeatProbe(state, false)
    expect(state.consecutiveFailures).toBe(1)
    expect(state.unreachable).toBe(false)
  })

  it('honors a custom threshold', () => {
    let state = initialHeartbeatState()
    state = reduceHeartbeatProbe(state, false, 2)
    expect(state.unreachable).toBe(false)
    state = reduceHeartbeatProbe(state, false, 2)
    expect(state.unreachable).toBe(true)
  })
})

describe('probeBackendReachability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true on 2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await expect(probeBackendReachability({ fetchImpl })).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      BACKEND_HEARTBEAT_PATH,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  it('returns false on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    await expect(probeBackendReachability({ fetchImpl })).resolves.toBe(false)
  })

  it('returns false on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(probeBackendReachability({ fetchImpl })).resolves.toBe(false)
  })

  it('aborts hung probes via timeout and returns false', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const pending = probeBackendReachability({ fetchImpl, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBe(false)
  })
})

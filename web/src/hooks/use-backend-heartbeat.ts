import { useEffect, useState } from 'react'
import {
  BACKEND_HEARTBEAT_FAILURE_THRESHOLD,
  BACKEND_HEARTBEAT_INTERVAL_MS,
  BACKEND_HEARTBEAT_PATH,
  BACKEND_HEARTBEAT_TIMEOUT_MS,
  initialHeartbeatState,
  probeBackendReachability,
  reduceHeartbeatProbe,
  type HeartbeatState,
} from '@/lib/backend-heartbeat'

export type UseBackendHeartbeatOptions = {
  enabled?: boolean
  intervalMs?: number
  failureThreshold?: number
  timeoutMs?: number
  path?: string
  fetchImpl?: typeof fetch
}

export type UseBackendHeartbeatResult = {
  unreachable: boolean
  consecutiveFailures: number
}

/**
 * App-shell heartbeat: polls reachability on an interval and exposes
 * `unreachable` only after `failureThreshold` consecutive failed probes.
 */
export function useBackendHeartbeat(
  options: UseBackendHeartbeatOptions = {},
): UseBackendHeartbeatResult {
  const {
    enabled = true,
    intervalMs = BACKEND_HEARTBEAT_INTERVAL_MS,
    failureThreshold = BACKEND_HEARTBEAT_FAILURE_THRESHOLD,
    timeoutMs = BACKEND_HEARTBEAT_TIMEOUT_MS,
    path = BACKEND_HEARTBEAT_PATH,
    fetchImpl,
  } = options

  const [state, setState] = useState<HeartbeatState>(initialHeartbeatState)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const outer = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      const ok = await probeBackendReachability({
        path,
        timeoutMs,
        signal: outer.signal,
        fetchImpl,
      })
      if (cancelled) return

      setState((prev) => reduceHeartbeatProbe(prev, ok, failureThreshold))

      if (!cancelled) {
        timer = setTimeout(() => {
          void tick()
        }, intervalMs)
      }
    }

    void tick()

    return () => {
      cancelled = true
      outer.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [enabled, intervalMs, timeoutMs, path, fetchImpl, failureThreshold])

  return {
    unreachable: enabled ? state.unreachable : false,
    consecutiveFailures: enabled ? state.consecutiveFailures : 0,
  }
}

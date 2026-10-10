/**
 * Backend reachability heartbeat (issue #105).
 *
 * Separate from the Health panel metrics (`/api/health` payload / `/api/healthz`):
 * this only asks "can we talk to the process?" and drives a global top banner.
 *
 * Defaults (documented for PR / operators):
 * - probe path: GET `/api/health` (always 2xx while the process is up; light enough)
 * - interval: 2500ms
 * - consecutive failures before banner: 3 (~5–7.5s of outage before show)
 * - per-probe AbortController timeout: 3000ms (hung TCP must not stall forever)
 */

export const BACKEND_HEARTBEAT_PATH = '/api/health'
export const BACKEND_HEARTBEAT_INTERVAL_MS = 2500
export const BACKEND_HEARTBEAT_FAILURE_THRESHOLD = 3
export const BACKEND_HEARTBEAT_TIMEOUT_MS = 3000

export type HeartbeatState = {
  consecutiveFailures: number
  unreachable: boolean
}

export function initialHeartbeatState(): HeartbeatState {
  return { consecutiveFailures: 0, unreachable: false }
}

/**
 * Pure reducer: one successful probe clears the banner; `threshold` consecutive
 * failures show it. Short single blips stay silent.
 */
export function reduceHeartbeatProbe(
  state: HeartbeatState,
  ok: boolean,
  threshold: number = BACKEND_HEARTBEAT_FAILURE_THRESHOLD,
): HeartbeatState {
  if (ok) {
    return { consecutiveFailures: 0, unreachable: false }
  }
  const consecutiveFailures = state.consecutiveFailures + 1
  return {
    consecutiveFailures,
    unreachable: consecutiveFailures >= threshold,
  }
}

export type ProbeBackendOptions = {
  path?: string
  timeoutMs?: number
  /** Outer abort (e.g. effect cleanup); also aborts the in-flight probe. */
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/**
 * Reachability probe. Network error / timeout / non-2xx → unreachable (false).
 * Any 2xx from `/api/health` means the backend answered.
 */
export async function probeBackendReachability(
  options: ProbeBackendOptions = {},
): Promise<boolean> {
  const path = options.path ?? BACKEND_HEARTBEAT_PATH
  const timeoutMs = options.timeoutMs ?? BACKEND_HEARTBEAT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener('abort', onOuterAbort, { once: true })
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(path, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

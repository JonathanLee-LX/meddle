import { TriangleAlert } from 'lucide-react'
import { useBackendHeartbeat } from '@/hooks/use-backend-heartbeat'

/** Exact product copy (Figma). Single line; keep in sync with banner test. */
export const BACKEND_HEARTBEAT_BANNER_TEXT =
  '连不上 Meddle 服务，正在重试。请确认 meddle 仍在运行'

/**
 * Global top-bar reachability banner. Mount once near the app shell so every
 * page keeps its existing chrome when the backend is down (no white-screen).
 * Independent of HealthPanel metrics polling.
 */
export function BackendHeartbeatBanner() {
  const { unreachable } = useBackendHeartbeat()

  if (!unreachable) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="backend-heartbeat-banner"
      className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <div className="mx-auto flex max-w-[1600px] items-center justify-center gap-2">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <p>{BACKEND_HEARTBEAT_BANNER_TEXT}</p>
      </div>
    </div>
  )
}

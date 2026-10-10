import { TriangleAlert } from 'lucide-react'
import { useBackendHeartbeat } from '@/hooks/use-backend-heartbeat'

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
        <p className="font-medium">后端连不上</p>
        <p className="text-destructive/80">
          无法连接 Meddle 服务；页面壳仍可用，恢复后提示会自动消失
        </p>
      </div>
    </div>
  )
}

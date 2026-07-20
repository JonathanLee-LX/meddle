import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Boxes, ExternalLink, Check } from 'lucide-react'

interface SessionInfo {
  id: string
  port: number
  pid: number
  meddleHome: string
  createdAt: string
  label: string
  alive: boolean
}

interface SessionsResponse {
  current: {
    id: string | null
    port: number
    isDefault: boolean
  }
  sessions: SessionInfo[]
}

export function SessionSwitcher() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SessionsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: SessionsResponse = await res.json()
      setData(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Open → reload. Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    load()
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, load])

  const currentLabel = data?.current.isDefault
    ? 'Default'
    : (data?.current.id ?? 'Session')

  const openSessionUrl = (port: number) => {
    window.open(`http://127.0.0.1:${port}/`, '_blank', 'noopener')
  }

  // Only show other sessions (excluding current) in the list.
  const otherSessions = data?.sessions.filter((s) => s.id !== data.current.id) ?? []

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        title="切换 session"
      >
        <Boxes data-icon="inline-start" />
        <span className="hidden sm:inline">{currentLabel}</span>
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {/* Current session */}
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            当前 session
          </div>
          {data && (
            <div className="flex items-center justify-between rounded-sm px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <Check className="size-3.5 text-primary shrink-0" />
                <span className="truncate text-sm">
                  {data.current.isDefault ? 'Default' : data.current.id}
                </span>
              </div>
              <Badge variant="secondary" className="shrink-0">
                :{data.current.port}
              </Badge>
            </div>
          )}

          {/* Divider */}
          <div className="my-1 h-px bg-border" />

          {/* Other sessions */}
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            其他 session
          </div>

          {loading && (
            <div className="space-y-1 px-1 py-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {error && (
            <div className="px-2 py-2 text-xs text-destructive">
              加载失败: {error}
            </div>
          )}

          {!loading && !error && otherSessions.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              暂无其他 session。用 <code className="rounded bg-muted px-1">meddle session create</code> 创建。
            </div>
          )}

          {!loading && !error && otherSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => openSessionUrl(s.port)}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${s.alive ? 'bg-green-500' : 'bg-red-500'}`}
                  title={s.alive ? 'running' : 'orphaned'}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {s.label || s.id}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.id}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="secondary">:{s.port}</Badge>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  TRAFFIC_NARROW_MAX_WIDTH_PX,
  loadTrafficSplitPct,
  pctFromPointer,
  saveTrafficSplitPct,
} from '@/lib/traffic-split'
import { useMediaQuery } from '@/hooks/use-media-query'

interface TrafficWorkLayoutProps {
  /** Left master: filter + dense table */
  master: ReactNode
  /** Right detail pane content (embedded DetailPanel) */
  detail: ReactNode
  /** Narrow drawer/Sheet host — rendered only when viewport is narrow */
  drawer?: ReactNode
  className?: string
}

/**
 * Layout B master-detail for shell-work only.
 * Wide: resizable ~60/40 split with localStorage width memory.
 * Narrow (≤900px): master full-width; detail collapses to drawer (caller-owned Sheet).
 */
export function TrafficWorkLayout({ master, detail, drawer, className }: TrafficWorkLayoutProps) {
  const isNarrow = useMediaQuery(`(max-width: ${TRAFFIC_NARROW_MAX_WIDTH_PX}px)`)
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(loadTrafficSplitPct)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = pctFromPointer(e.clientX, rect.left, rect.width)
      setLeftPct(next)
    }

    const onUp = () => {
      setDragging(false)
      setLeftPct((current) => saveTrafficSplitPct(current))
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging])

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  if (isNarrow) {
    return (
      <div
        data-testid="traffic-work-layout"
        data-layout="narrow"
        className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      >
        <div data-testid="traffic-master" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {master}
        </div>
        {drawer}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="traffic-work-layout"
      data-layout="split"
      data-split-pct={leftPct}
      className={cn('flex min-h-0 flex-1 overflow-hidden', className)}
    >
      <div
        data-testid="traffic-master"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ width: `${leftPct}%` }}
      >
        {master}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftPct}
        aria-valuemin={35}
        aria-valuemax={75}
        aria-label="调整流量列表与详情分栏宽度"
        data-testid="traffic-split-handle"
        className={cn(
          'group relative z-10 w-1 shrink-0 cursor-col-resize bg-border transition-colors',
          dragging ? 'bg-primary' : 'hover:bg-primary/60',
        )}
        onMouseDown={onResizeStart}
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      <div
        data-testid="traffic-detail"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l bg-muted/20"
      >
        {detail}
      </div>
    </div>
  )
}

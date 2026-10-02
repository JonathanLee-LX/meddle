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
  /** Wide only: when false, hide detail + split handle; master fills width (#102) */
  detailOpen?: boolean
  className?: string
}

/**
 * Layout B master-detail for shell-work only.
 * Wide: resizable ~60/40 split with localStorage width memory (detail hidden when detailOpen=false).
 * Narrow (≤900px): master full-width; detail collapses to drawer (caller-owned Sheet).
 */
export function TrafficWorkLayout({
  master,
  detail,
  drawer,
  detailOpen = true,
  className,
}: TrafficWorkLayoutProps) {
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
        data-detail-open={detailOpen ? 'true' : 'false'}
        className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      >
        <div data-testid="traffic-master" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {master}
        </div>
        {drawer}
      </div>
    )
  }

  if (!detailOpen) {
    return (
      <div
        data-testid="traffic-work-layout"
        data-layout="master-only"
        data-detail-open="false"
        className={cn('flex min-h-0 flex-1 overflow-hidden', className)}
      >
        <div data-testid="traffic-master" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {master}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="traffic-work-layout"
      data-layout="split"
      data-detail-open="true"
      data-split-pct={leftPct}
      className={cn('flex min-h-0 flex-1 overflow-hidden', className)}
    >
      <div
        data-testid="traffic-master"
        className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
        style={{ flex: `0 0 ${leftPct}%`, width: `${leftPct}%` }}
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
        className="group relative z-10 w-px shrink-0 cursor-col-resize"
        onMouseDown={onResizeStart}
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-border transition-colors',
            dragging ? 'bg-primary' : 'group-hover:bg-transparent',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 opacity-0 transition-opacity',
            dragging ? 'bg-primary opacity-100' : 'bg-primary/60 group-hover:opacity-100',
          )}
        />
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      <div
        data-testid="traffic-detail"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {detail}
      </div>
    </div>
  )
}

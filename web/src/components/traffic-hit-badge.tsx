import { cn } from '@/lib/utils'
import { getTrafficHitSummary, type TrafficHitKind, type TrafficHitSummary } from '@/lib/traffic-hit'
import type { ProxyRecord } from '@/types'

/** Dense table badge (~14px) — aligns with wireframe b.png hit column. */
const hitBadgeBaseClassName =
  'inline-flex h-[14px] min-w-[28px] items-center justify-center rounded-sm border px-1 text-[9px] leading-none'

const hitBadgeKindClassName: Record<TrafficHitKind, string> = {
  mock: 'border-border bg-muted font-semibold text-foreground',
  rule: 'border-border bg-muted/70 font-semibold text-foreground',
  /** Dashed muted shell — visible placeholder, not noisy. */
  pass: 'border-dashed border-muted-foreground/40 bg-transparent font-normal text-muted-foreground',
}

export interface TrafficHitBadgeProps {
  record: Pick<ProxyRecord, 'mock' | 'source' | 'target'>
  className?: string
  /** Optional precomputed summary (avoids double derive in hot rows). */
  summary?: TrafficHitSummary
}

/**
 * Compact hit-column badge for the traffic table.
 * Mock / Rule: clear filled muted chips. Pass: dashed muted "—" (empty affordance).
 */
export function TrafficHitBadge({ record, className, summary }: TrafficHitBadgeProps) {
  const hit = summary ?? getTrafficHitSummary(record)
  return (
    <span
      role="status"
      data-slot="traffic-hit-badge"
      data-hit-kind={hit.kind}
      title={hit.title}
      className={cn(hitBadgeBaseClassName, hitBadgeKindClassName[hit.kind], className)}
    >
      {hit.badge}
    </span>
  )
}

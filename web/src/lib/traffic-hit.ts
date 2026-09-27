/**
 * Display-only hit summary for traffic rows / detail overview.
 * Derives from existing ProxyRecord fields — no core matching changes.
 */

import type { ProxyRecord } from '@/types'

export type TrafficHitKind = 'mock' | 'rule' | 'pass'

export interface TrafficHitSummary {
  kind: TrafficHitKind
  /** Short badge label for table */
  badge: string
  /** Overview title */
  title: string
  /** One-line description */
  description: string
}

export function getTrafficHitSummary(record: Pick<ProxyRecord, 'mock' | 'source' | 'target'>): TrafficHitSummary {
  if (record.mock) {
    return {
      kind: 'mock',
      badge: 'Mock',
      title: '命中 Mock',
      description: '该请求由本地 Mock 短路返回，未转发到上游。',
    }
  }

  if (record.source !== record.target) {
    return {
      kind: 'rule',
      badge: 'Rule',
      title: '命中 Rule · 转发改写',
      description: '源地址与目标地址不同，请求路径被规则改写后转发。',
    }
  }

  return {
    kind: 'pass',
    badge: '—',
    title: '未改写 / 透传',
    description: '源与目标一致，未命中 Mock；如有规则则未改写地址。',
  }
}

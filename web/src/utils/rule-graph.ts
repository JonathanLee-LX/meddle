import type { RuleItem } from '@/types'

const ABSOLUTE_FILE_PATTERN = /^file:\/\//i
const LOCAL_FILE_PATTERN = /^[A-Za-z]:\\|^\//;
const ABSOLUTE_URL_PATTERN = /^(https?|wss?):\/\//i

export interface RouteTargetMeta {
  rawTarget: string
  displayTarget: string
  kind: 'empty' | 'file' | 'absolute-url' | 'host'
  hint: string
}

export interface RuleGraphEntry {
  id: string
  index: number
  matchOrder: number
  enabledOrder: number | null
  enabled: boolean
  rule: string
  target: string
  marker: string | null
  targetMeta: RouteTargetMeta
}

export interface RuleGraphTargetGroup {
  key: string
  target: string
  targetMeta: RouteTargetMeta
  entries: RuleGraphEntry[]
  enabledCount: number
  disabledCount: number
  firstMatchOrder: number
  firstEnabledOrder: number | null
}

export interface RuleGraphData {
  entries: RuleGraphEntry[]
  groups: RuleGraphTargetGroup[]
  enabledEntryCount: number
  visibleEntryCount: number
  visibleTargetCount: number
}

export function analyzeRouteTarget(target: string): RouteTargetMeta {
  const trimmed = target.trim()

  if (!trimmed) {
    return {
      rawTarget: target,
      displayTarget: '未配置目标',
      kind: 'empty',
      hint: '该规则没有目标地址，命中后无法形成有效转发。',
    }
  }

  if (ABSOLUTE_FILE_PATTERN.test(trimmed) || LOCAL_FILE_PATTERN.test(trimmed)) {
    return {
      rawTarget: target,
      displayTarget: trimmed,
      kind: 'file',
      hint: '命中后会改为读取本地文件或本地目录内容。',
    }
  }

  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    return {
      rawTarget: target,
      displayTarget: trimmed,
      kind: 'absolute-url',
      hint: '命中后会使用这里声明的完整目标地址进行转发。',
    }
  }

  return {
    rawTarget: target,
    displayTarget: trimmed,
    kind: 'host',
    hint: '命中后会继承原请求协议，并补全原请求的路径、查询参数和缺失端口。',
  }
}

function extractRuleMarker(rule: string): string | null {
  const match = rule.match(/\[([^\]]+)\]/)
  return match?.[1] ?? null
}

export function buildRuleGraph(rules: RuleItem[], visibleIndices?: number[]): RuleGraphData {
  const visibleIndexSet = visibleIndices ? new Set(visibleIndices) : null
  const visibleEntries: RuleGraphEntry[] = []
  let enabledOrder = 0

  rules.forEach((rule, index) => {
    const nextEnabledOrder = rule.enabled ? ++enabledOrder : null
    if (visibleIndexSet && !visibleIndexSet.has(index)) {
      return
    }

    visibleEntries.push({
      id: `rule-graph-${index}`,
      index,
      matchOrder: index + 1,
      enabledOrder: nextEnabledOrder,
      enabled: rule.enabled,
      rule: rule.rule,
      target: rule.target,
      marker: extractRuleMarker(rule.rule),
      targetMeta: analyzeRouteTarget(rule.target),
    })
  })

  const groupsByTarget = new Map<string, RuleGraphTargetGroup>()

  visibleEntries.forEach((entry) => {
    const key = entry.target.trim() || '__EMPTY_TARGET__'
    const existing = groupsByTarget.get(key)

    if (!existing) {
      groupsByTarget.set(key, {
        key,
        target: entry.target,
        targetMeta: entry.targetMeta,
        entries: [entry],
        enabledCount: entry.enabled ? 1 : 0,
        disabledCount: entry.enabled ? 0 : 1,
        firstMatchOrder: entry.matchOrder,
        firstEnabledOrder: entry.enabledOrder,
      })
      return
    }

    existing.entries.push(entry)
    existing.enabledCount += entry.enabled ? 1 : 0
    existing.disabledCount += entry.enabled ? 0 : 1
    existing.firstMatchOrder = Math.min(existing.firstMatchOrder, entry.matchOrder)
    if (existing.firstEnabledOrder == null) {
      existing.firstEnabledOrder = entry.enabledOrder
    } else if (entry.enabledOrder != null) {
      existing.firstEnabledOrder = Math.min(existing.firstEnabledOrder, entry.enabledOrder)
    }
  })

  const groups = Array.from(groupsByTarget.values())
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((a, b) => a.index - b.index),
    }))
    .sort((a, b) => {
      if (a.firstEnabledOrder == null && b.firstEnabledOrder == null) {
        return a.firstMatchOrder - b.firstMatchOrder
      }
      if (a.firstEnabledOrder == null) return 1
      if (b.firstEnabledOrder == null) return -1
      return a.firstEnabledOrder - b.firstEnabledOrder
    })

  return {
    entries: visibleEntries,
    groups,
    enabledEntryCount: visibleEntries.filter((entry) => entry.enabled).length,
    visibleEntryCount: visibleEntries.length,
    visibleTargetCount: groups.length,
  }
}

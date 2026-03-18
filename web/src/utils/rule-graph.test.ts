import { describe, expect, it } from 'vitest'
import type { RuleItem } from '@/types'
import { analyzeRouteTarget, buildRuleGraph } from './rule-graph'

describe('rule-graph', () => {
  const rules: RuleItem[] = [
    { enabled: true, rule: '^https://api.example.com/users', target: '127.0.0.1:3000' },
    { enabled: false, rule: '^https://api.example.com/admin', target: '127.0.0.1:3000' },
    { enabled: true, rule: '^https://static.example.com/[assets]', target: 'localhost:8080' },
    { enabled: true, rule: '^https://download.example.com/file', target: 'file:///tmp/demo.json' },
  ]

  it('keeps global enabled order based on file order', () => {
    const graph = buildRuleGraph(rules)
    expect(graph.entries.map((entry) => entry.enabledOrder)).toEqual([1, null, 2, 3])
  })

  it('groups visible rules by target', () => {
    const graph = buildRuleGraph(rules)
    expect(graph.groups).toHaveLength(3)
    expect(graph.groups[0].target).toBe('127.0.0.1:3000')
    expect(graph.groups[0].entries).toHaveLength(2)
  })

  it('preserves actual priority labels when filtered', () => {
    const graph = buildRuleGraph(rules, [2, 3])
    expect(graph.entries.map((entry) => entry.enabledOrder)).toEqual([2, 3])
  })

  it('detects marker rewrite from rule pattern', () => {
    const graph = buildRuleGraph(rules)
    expect(graph.entries[2].marker).toBe('assets')
  })

  it('classifies host targets and describes inherited routing behavior', () => {
    expect(analyzeRouteTarget('127.0.0.1:3000')).toMatchObject({
      kind: 'host',
      displayTarget: '127.0.0.1:3000',
    })
  })

  it('classifies absolute urls and local files', () => {
    expect(analyzeRouteTarget('https://upstream.example.com/api')).toMatchObject({
      kind: 'absolute-url',
    })
    expect(analyzeRouteTarget('file:///tmp/demo.json')).toMatchObject({
      kind: 'file',
    })
  })
})

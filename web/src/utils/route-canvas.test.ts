import { describe, expect, it } from 'vitest'
import type { RuleItem } from '@/types'
import { buildRuleGraph } from './rule-graph'
import { buildRouteCanvasLayout } from './route-canvas'

describe('route-canvas', () => {
  const rules: RuleItem[] = [
    { enabled: true, rule: 'a.com', target: 'http://localhost:3000', exclusions: [] },
    { enabled: true, rule: 'b.com', target: 'http://localhost:3000', exclusions: [] },
    { enabled: false, rule: 'c.com', target: 'http://localhost:4000', exclusions: [] },
  ]

  it('places all rules into one canvas layout with shared target nodes', () => {
    const graphData = buildRuleGraph(rules)
    const layout = buildRouteCanvasLayout(graphData)

    expect(layout.nodes.filter((node) => node.type === 'routeSource')).toHaveLength(3)
    expect(layout.nodes.filter((node) => node.type === 'routeTarget')).toHaveLength(2)
    expect(layout.edges).toHaveLength(3)
  })

  it('reuses a single target node when multiple rules route to the same target', () => {
    const graphData = buildRuleGraph(rules)
    const layout = buildRouteCanvasLayout(graphData)

    const sharedTargetEdges = layout.edges.filter((edge) => edge.target === 'target:http://localhost:3000')
    expect(sharedTargetEdges).toHaveLength(2)
    expect(new Set(sharedTargetEdges.map((edge) => edge.target)).size).toBe(1)
  })

  it('calculates a canvas height large enough to fit all groups', () => {
    const graphData = buildRuleGraph(rules)
    const layout = buildRouteCanvasLayout(graphData)

    expect(layout.canvasHeight).toBeGreaterThanOrEqual(360)
  })
})

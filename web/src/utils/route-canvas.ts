import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { RuleGraphData, RuleGraphEntry, RuleGraphTargetGroup } from './rule-graph'

export interface RouteSourceNodeData extends Record<string, unknown> {
  label: string
  enabledOrder: number | null
  marker: string | null
}

export interface RouteTargetNodeData extends Record<string, unknown> {
  label: string
  targetKind: RuleGraphTargetGroup['targetMeta']['kind']
}

export type RouteSourceNode = Node<RouteSourceNodeData, 'routeSource'>
export type RouteTargetNode = Node<RouteTargetNodeData, 'routeTarget'>
export type RouteCanvasNode = RouteSourceNode | RouteTargetNode
export type RouteCanvasEdge = Edge<{ branchX: number; direct: boolean }, 'routeBranch'>

export interface RouteCanvasLayout {
  nodes: RouteCanvasNode[]
  edges: RouteCanvasEdge[]
  canvasHeight: number
}

const SOURCE_X = 28
const TARGET_X = 470
const START_Y = 24
const SOURCE_NODE_HEIGHT = 64
const SOURCE_NODE_WIDTH = 268
const TARGET_NODE_HEIGHT = 84
const TARGET_NODE_WIDTH = 264
const NODE_GAP_Y = 16
const GROUP_GAP_Y = 52
const CANVAS_MIN_HEIGHT = 360
const CANVAS_BOTTOM_PADDING = 28
const EDGE_BRANCH_OFFSET = 56

function getGroupHeight(group: RuleGraphTargetGroup): number {
  const sourceStackHeight =
    group.entries.length * SOURCE_NODE_HEIGHT + Math.max(0, group.entries.length - 1) * NODE_GAP_Y
  return Math.max(sourceStackHeight, TARGET_NODE_HEIGHT)
}

function buildSourceNode(entry: RuleGraphEntry, y: number): RouteCanvasNode {
  return {
    id: `source:${entry.id}`,
    type: 'routeSource',
    position: { x: SOURCE_X, y },
    draggable: false,
    selectable: false,
    data: {
      label: entry.rule || '未填写规则',
      enabledOrder: entry.enabledOrder,
      marker: entry.marker,
    },
    style: {
      width: SOURCE_NODE_WIDTH,
      height: SOURCE_NODE_HEIGHT,
    },
  }
}

function buildTargetNode(group: RuleGraphTargetGroup, y: number): RouteCanvasNode {
  return {
    id: `target:${group.key}`,
    type: 'routeTarget',
    position: { x: TARGET_X, y },
    draggable: false,
    selectable: false,
    data: {
      label: group.targetMeta.displayTarget,
      targetKind: group.targetMeta.kind,
    },
    style: {
      width: TARGET_NODE_WIDTH,
      height: TARGET_NODE_HEIGHT,
    },
  }
}

function buildEdge(entry: RuleGraphEntry, group: RuleGraphTargetGroup): RouteCanvasEdge {
  return {
    id: `edge:${entry.id}:${group.key}`,
    source: `source:${entry.id}`,
    target: `target:${group.key}`,
    type: 'routeBranch',
    animated: entry.enabled,
    selectable: false,
      focusable: false,
      data: {
      branchX: TARGET_X - EDGE_BRANCH_OFFSET,
      direct: group.entries.length === 1,
    },
    style: {
      stroke: entry.enabled ? 'var(--color-primary)' : 'var(--color-border)',
      strokeWidth: entry.enabled ? 2.2 : 1.3,
      opacity: entry.enabled ? 0.95 : 0.45,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: entry.enabled ? 'var(--color-primary)' : 'var(--color-border)',
    },
  }
}

export function buildRouteCanvasLayout(graphData: RuleGraphData): RouteCanvasLayout {
  const nodes: RouteCanvasNode[] = []
  const edges: RouteCanvasEdge[] = []

  let cursorY = START_Y

  graphData.groups.forEach((group) => {
    const sourceStackHeight =
      group.entries.length * SOURCE_NODE_HEIGHT + Math.max(0, group.entries.length - 1) * NODE_GAP_Y
    const groupHeight = getGroupHeight(group)
    const sourceStartY = cursorY + Math.max(0, (groupHeight - sourceStackHeight) / 2)
    const targetY = cursorY + Math.max(0, (groupHeight - TARGET_NODE_HEIGHT) / 2)

    nodes.push(buildTargetNode(group, targetY))

    group.entries.forEach((entry, entryIndex) => {
      const sourceY = sourceStartY + entryIndex * (SOURCE_NODE_HEIGHT + NODE_GAP_Y)
      nodes.push(buildSourceNode(entry, sourceY))
      edges.push(buildEdge(entry, group))
    })

    cursorY += groupHeight + GROUP_GAP_Y
  })

  return {
    nodes,
    edges,
    canvasHeight: Math.max(CANVAS_MIN_HEIGHT, cursorY - GROUP_GAP_Y + CANVAS_BOTTOM_PADDING),
  }
}

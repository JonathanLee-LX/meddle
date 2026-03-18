import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  type EdgeProps,
  type EdgeTypes,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RuleGraphData } from '@/utils/rule-graph'
import {
  buildRouteCanvasLayout,
  type RouteSourceNode,
  type RouteTargetNode,
} from '@/utils/route-canvas'
import { useMemo } from 'react'

const TARGET_KIND_LABELS = {
  empty: '未配置',
  file: '本地文件',
  'absolute-url': '完整 URL',
  host: '主机转发',
} as const

function RouteSourceNodeView({ data }: NodeProps<RouteSourceNode>) {
  const active = data.enabledOrder != null

  return (
    <div
      className={cn(
        'route-canvas-node flex h-full flex-col justify-center rounded-2xl border px-3.5 py-2.5 shadow-sm',
        active ? 'border-border bg-card' : 'border-dashed border-border/80 bg-muted/35 opacity-85',
      )}
    >
      <Handle type="source" position={Position.Right} isConnectable={false} className="route-canvas-handle" />
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={active ? 'default' : 'secondary'} className="font-mono">
          {data.enabledOrder != null ? `#${data.enabledOrder}` : '停用'}
        </Badge>
        <span className="text-[13px] font-medium break-all">{data.label}</span>
      </div>
      {data.marker && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          {`[${data.marker}]`}
        </div>
      )}
    </div>
  )
}

function RouteTargetNodeView({ data }: NodeProps<RouteTargetNode>) {
  return (
    <div
      className={cn(
        'route-canvas-node flex h-full items-center rounded-[22px] border px-4 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)]',
        'border-primary/20 bg-primary/6',
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="route-canvas-handle" />
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{TARGET_KIND_LABELS[data.targetKind]}</Badge>
          </div>
          <div className="mt-2 text-[14px] font-semibold break-all leading-5">
            {data.label}
          </div>
        </div>
      </div>
    </div>
  )
}

function RouteBranchEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const edgeData = data as { branchX?: number; direct?: boolean } | undefined
  const branchX = edgeData?.branchX ?? sourceX + 72
  const path = edgeData?.direct
    ? `M ${sourceX} ${sourceY} L ${targetX} ${sourceY}`
    : `M ${sourceX} ${sourceY} L ${branchX} ${sourceY} L ${branchX} ${targetY} L ${targetX} ${targetY}`

  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />
}

const nodeTypes: NodeTypes = {
  routeSource: RouteSourceNodeView,
  routeTarget: RouteTargetNodeView,
}

const edgeTypes: EdgeTypes = {
  routeBranch: RouteBranchEdge,
}

interface RouteCanvasProps {
  graphData: RuleGraphData
}

export function RouteCanvas({ graphData }: RouteCanvasProps) {
  const { nodes, edges, canvasHeight } = useMemo(() => buildRouteCanvasLayout(graphData), [graphData])

  return (
    <div className="route-canvas rounded-[24px] border bg-[linear-gradient(135deg,rgba(15,23,42,0.03),rgba(15,23,42,0.01)),radial-gradient(circle_at_top_left,rgba(59,130,246,0.06),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.06),transparent_24%)] p-2">
      <div
        className="overflow-hidden rounded-[20px] border bg-background/85"
        style={{ height: canvasHeight }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1.02 }}
          minZoom={0.5}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnDoubleClick={false}
          preventScrolling={false}
          colorMode="light"
          className="route-canvas-flow h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        </ReactFlow>
      </div>
    </div>
  )
}

import { useState, useMemo, type ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Wand2, RotateCw, Activity, XCircle, ArrowRight, ArrowDown, Clock, CornerDownRight, Flag, Route, ShieldCheck, ChevronDown, ChevronRight, Monitor, Server } from 'lucide-react'
import { diffLines } from 'diff'
import { highlightCode } from '@/lib/syntax-highlight'
import { ApplicationIcon } from '@/components/application-icon'
import type { RecordDetail, ProxyRecord, InspectionStage } from '@/types'
import { BodyDiffView } from './body-diff-view'

interface DetailPanelProps {
  open?: boolean
  onClose?: () => void
  embedded?: boolean
  detail: RecordDetail | null
  loading: boolean
  error?: string | null
  selectedRecord?: ProxyRecord
  onCreateMock?: (data: { source: string; responseBody: string; statusCode: number; responseHeaders?: Record<string, string> }) => void
  onReplay?: (id: number) => Promise<unknown>
}

function getStatusColor(code: number) {
  if (code >= 200 && code < 300) return 'bg-green-100 text-green-800'
  if (code >= 300 && code < 400) return 'bg-blue-100 text-blue-800'
  if (code >= 400 && code < 500) return 'bg-amber-100 text-amber-800'
  if (code >= 500) return 'bg-red-100 text-red-800'
  return ''
}

function HeadersView({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers || {})
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">无头部信息</p>
  }
  return (
    <div className="font-mono text-xs space-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 py-0.5 hover:bg-muted/50 px-1 rounded">
          <span className="text-purple-600 shrink-0 font-semibold">{key}:</span>
          <span className="text-foreground/80 break-all">{value}</span>
        </div>
      ))}
    </div>
  )
}

function BodyView({ body }: { body: string }) {
  // 使用轻量级语法高亮（类似 Chrome DevTools）
  const highlightedBody = useMemo(() => {
    if (!body) return null
    return highlightCode(body)
  }, [body])

  if (!body) {
    return <p className="text-sm text-muted-foreground py-2">无内容</p>
  }

  return (
    <div className="font-mono text-xs bg-muted/30 rounded p-2">
      <pre className="whitespace-pre-wrap break-all">{highlightedBody}</pre>
    </div>
  )
}

function getStatusBadgeVariant(status: InspectionStage['status']) {
  switch (status) {
    case 'ok':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'error':
      return 'bg-red-100 text-red-800 border-red-200'
    case 'skipped':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'short-circuited':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    default:
      return ''
  }
}

function getStageStatusLabel(status: InspectionStage['status']) {
  switch (status) {
    case 'ok':
      return '通过'
    case 'error':
      return '异常'
    case 'skipped':
      return '跳过'
    case 'short-circuited':
      return '已短路返回'
    default:
      return status
  }
}

function getStageTypeLabel(type: InspectionStage['type']) {
  switch (type) {
    case 'builtin':
      return '内置'
    case 'custom':
      return '自定义'
    case 'system':
      return '系统'
    default:
      return type
  }
}

function formatStageName(name: string) {
  return name.replace(/^builtin\./, '').replace(/^custom\./, '')
}

function getStageKey(stage: InspectionStage, index: number) {
  return `${index}-${stage.hook}-${stage.name}`
}

function getStagePhase(hook: InspectionStage['hook']): 'request' | 'response' {
  return hook === 'onBeforeResponse' || hook === 'onAfterResponse' ? 'response' : 'request'
}

function getChangedHeaderEntries(before: Record<string, string>, after: Record<string, string>) {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  return keys
    .map((key) => ({
      key,
      before: before[key] ?? '',
      after: after[key] ?? '',
    }))
    .filter((entry) => entry.before !== entry.after)
}

function HeaderSnapshotView({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)
  if (entries.length === 0) {
    return <span className="text-muted-foreground italic">(无)</span>
  }
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="break-all">
          <span className="text-muted-foreground">{key}:</span> {value}
        </div>
      ))}
    </div>
  )
}

function DiffLinePreview({
  lines,
  className,
}: {
  lines: Array<{ type: 'added' | 'removed'; text: string }>
  className?: string
}) {
  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground">无变更</p>
  }

  return (
    <div className={`rounded-lg border bg-muted/20 p-2 text-xs font-mono space-y-1 ${className || ''}`}>
      {lines.map((line, index) => (
        <div
          key={`${line.type}-${index}-${line.text}`}
          className={`whitespace-pre-wrap break-all px-2 py-1 rounded ${
            line.type === 'added'
              ? 'bg-green-500/10 text-green-700 dark:text-green-300'
              : 'bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          <span className="mr-1">{line.type === 'added' ? '+ ' : '- '}</span>
          {line.text}
        </div>
      ))}
    </div>
  )
}

function buildKeyValueDiffLines(
  label: string,
  before: string | number | undefined,
  after: string | number | undefined,
) {
  const lines: Array<{ type: 'added' | 'removed'; text: string }> = []

  if (before !== undefined && before !== '') {
    lines.push({ type: 'removed', text: `${label} ${before}` })
  }

  if (after !== undefined && after !== '') {
    lines.push({ type: 'added', text: `${label} ${after}` })
  }

  return lines
}

function buildRawDiffLines(before: string | undefined, after: string | undefined) {
  const lines: Array<{ type: 'added' | 'removed'; text: string }> = []

  if (before !== undefined && before !== '') {
    lines.push({ type: 'removed', text: before })
  }

  if (after !== undefined && after !== '') {
    lines.push({ type: 'added', text: after })
  }

  return lines
}

function splitDisplayLines(value: string) {
  const normalized = value.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.length > 0 ? lines : ['']
}

function isBinaryBodyValue(value: string) {
  if (!value) return false
  if (/^\(binary(?:,\s*\d+\s+bytes)?\)$/i.test(value.trim())) return true

  let controlCount = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || code === 65533) {
      controlCount += 1
    }
  }

  return controlCount > 0 && controlCount / Math.max(value.length, 1) > 0.15
}

function HeaderDiffPreview({
  before,
  after,
}: {
  before: Record<string, string>
  after: Record<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const changedEntries = useMemo(() => getChangedHeaderEntries(before, after), [before, after])
  const diffLines = useMemo(
    () => changedEntries.flatMap((entry) => buildKeyValueDiffLines(entry.key, entry.before, entry.after)),
    [changedEntries],
  )

  if (diffLines.length === 0) {
    return <p className="text-xs text-muted-foreground">无变更</p>
  }

  return (
    <div className="space-y-2">
      <DiffLinePreview lines={diffLines} />
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
        {expanded ? '收起完整头部' : '展开完整头部'}
      </Button>
      {expanded && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-muted/50 p-2 text-xs font-mono">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">变更前</div>
            <HeaderSnapshotView headers={before} />
          </div>
          <div className="rounded-lg bg-muted/50 p-2 text-xs font-mono">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">变更后</div>
            <HeaderSnapshotView headers={after} />
          </div>
        </div>
      )}
    </div>
  )
}

function CompactBodyDiff({
  before,
  after,
}: {
  before: string
  after: string
}) {
  const [expanded, setExpanded] = useState(false)
  const changedParts = useMemo(
    () => diffLines(before || '', after || '').filter((part) => part.added || part.removed),
    [before, after],
  )
  const hasBinaryBody = useMemo(
    () => isBinaryBodyValue(before || '') || isBinaryBodyValue(after || ''),
    [before, after],
  )
  const previewLines = useMemo(
    () => {
      if (hasBinaryBody) {
        return buildRawDiffLines(before || '', after || '')
      }

      return changedParts.flatMap((part) =>
        splitDisplayLines(part.value).map((line) => ({
          type: part.added ? 'added' : 'removed',
          text: line,
        })),
      ) as Array<{ type: 'added' | 'removed'; text: string }>
    },
    [before, after, changedParts, hasBinaryBody],
  )

  if (previewLines.length === 0) {
    return <p className="text-xs text-muted-foreground">无变更</p>
  }

  return (
    <div className="space-y-2">
      <DiffLinePreview lines={previewLines} className="max-h-40 overflow-auto" />
      {!hasBinaryBody && (
        <>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
            {expanded ? '收起完整 Diff' : '展开完整 Diff'}
          </Button>
          {expanded && (
            <BodyDiffView original={before} modified={after} mode="inline" maxHeight="220px" />
          )}
        </>
      )}
    </div>
  )
}

function StageDiffSections({ stage }: { stage: InspectionStage }) {
  const changes = stage.changes
  if (!changes) return null

  return (
    <div className="space-y-2">
      {(changes.targetBefore || changes.targetAfter) && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Request URL Diff</div>
          <DiffLinePreview
            lines={buildKeyValueDiffLines('Request URL', changes.targetBefore, changes.targetAfter || changes.target)}
          />
        </div>
      )}

      {(changes.requestHeadersBefore || changes.requestHeadersAfter) && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Request Header Diff</div>
          <HeaderDiffPreview before={changes.requestHeadersBefore || {}} after={changes.requestHeadersAfter || {}} />
        </div>
      )}

      {(changes.responseStatusCodeBefore !== undefined || changes.responseStatusCodeAfter !== undefined) && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Response Status Diff</div>
          <DiffLinePreview
            lines={buildKeyValueDiffLines(
              'Response Status',
              changes.responseStatusCodeBefore,
              changes.responseStatusCodeAfter ?? changes.responseStatusCode,
            )}
          />
        </div>
      )}

      {(changes.responseHeadersBefore || changes.responseHeadersAfter) && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Response Header Diff</div>
          <HeaderDiffPreview before={changes.responseHeadersBefore || {}} after={changes.responseHeadersAfter || {}} />
        </div>
      )}

      {(changes.responseBodyBefore !== undefined || changes.responseBodyAfter !== undefined) && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Response Body Diff</div>
          <CompactBodyDiff before={changes.responseBodyBefore || ''} after={changes.responseBodyAfter || changes.responseBody || ''} />
        </div>
      )}
    </div>
  )
}

function StageCard({
  stage,
  index,
  isLast,
  accentClass,
}: {
  stage: InspectionStage
  index: number
  isLast: boolean
  accentClass: string
}) {
  const [expanded, setExpanded] = useState(stage.status !== 'skipped')

  return (
    <div className="space-y-2">
      <div className="rounded-xl border bg-background/90 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-xs"
              onClick={() => setExpanded((value) => !value)}
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
            <span className="font-medium text-sm">{index + 1}. {formatStageName(stage.name)}</span>
            <Badge variant="outline" className="text-xs font-normal">
              {stage.hook}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {getStageTypeLabel(stage.type)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {stage.status === 'short-circuited'
              ? '这一阶段直接生成了响应，请求不会继续往后转发。'
              : stage.status === 'error'
                ? '这一阶段执行失败，影响了后续处理流程。'
                : '这一阶段执行完成，请求继续进入下一步。'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={`text-xs border ${getStatusBadgeVariant(stage.status)}`}>
            {getStageStatusLabel(stage.status)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {stage.duration}ms
          </span>
        </div>
      </div>

      {expanded && (
        <>
          {stage.target && (
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                当前 Target
              </div>
              <div className="font-mono text-xs break-all">
                {stage.target}
              </div>
            </div>
          )}

          <StageDiffSections stage={stage} />

          {stage.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Error: {stage.error}
            </div>
          )}
        </>
      )}
      </div>

      {!isLast && (
        <div className="flex justify-center py-1">
          <div className="flex flex-col items-center gap-1">
            <div className={`h-2.5 w-2.5 rounded-full ${accentClass} animate-pulse`} />
            <ArrowDown className={`h-4 w-4 ${accentClass} animate-bounce`} />
          </div>
        </div>
      )}
    </div>
  )
}

function StageColumn({
  title,
  description,
  stages,
  icon,
  roleLabel,
  roleIcon,
  accentClass,
}: {
  title: string
  description: string
  stages: Array<{ stage: InspectionStage; index: number }>
  icon: ReactNode
  roleLabel: string
  roleIcon: ReactNode
  accentClass: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-[11px] font-normal">
              <span className="mr-1">{roleIcon}</span>
              {roleLabel}
            </Badge>
          </div>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <span className={accentClass}>{icon}</span>
            {title}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {stages.length} 个阶段
        </Badge>
      </div>

      {stages.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">无阶段信息</p>
      ) : (
        <div className="space-y-3">
          {stages.map(({ stage, index }, stageIndex) => (
            <StageCard
              key={getStageKey(stage, index)}
              stage={stage}
              index={index}
              isLast={stageIndex === stages.length - 1}
              accentClass={accentClass}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function getFinalOutcome(inspection: NonNullable<RecordDetail['inspection']>) {
  const shortCircuitStage = [...inspection.stages].reverse().find((stage) => stage.status === 'short-circuited')
  if (shortCircuitStage) {
    return {
      label: '提前返回响应',
      description: `在 ${formatStageName(shortCircuitStage.name)} 阶段直接生成响应`,
      icon: <CornerDownRight className="h-4 w-4 text-blue-500" />,
    }
  }

  const errorStage = [...inspection.stages].reverse().find((stage) => stage.status === 'error')
  if (errorStage) {
    return {
      label: '处理过程中出现异常',
      description: `${formatStageName(errorStage.name)} 执行失败`,
      icon: <XCircle className="h-4 w-4 text-red-500" />,
    }
  }

  return {
    label: '进入正常代理流程',
    description: '请求经过检查后继续转发到目标服务',
    icon: <ArrowRight className="h-4 w-4 text-emerald-500" />,
  }
}

function InspectionView({ inspection }: { inspection: NonNullable<RecordDetail['inspection']> }) {
  const finalOutcome = getFinalOutcome(inspection)
  const stageEntries = inspection.stages.map((stage, index) => ({ stage, index }))
  const requestStages = stageEntries.filter(({ stage }) => getStagePhase(stage.hook) === 'request')
  const responseStages = stageEntries.filter(({ stage }) => getStagePhase(stage.hook) === 'response')

  return (
    <div className="space-y-4 pt-3">
      <div className="rounded-xl border bg-gradient-to-br from-muted/20 via-background to-muted/10 p-4 space-y-4">
        <div className="flex items-center gap-4 text-sm">
          <Badge variant="outline" className="font-mono">
            {inspection.method}
          </Badge>
          <span className="font-mono text-muted-foreground truncate flex-1">
            {inspection.url}
          </span>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">{inspection.totalDuration}ms</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-background/80 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Route className="h-3.5 w-3.5" />
              请求入口
            </div>
            <div className="text-sm font-medium">请求进入代理</div>
            <div className="text-xs text-muted-foreground mt-1">
              从浏览器或客户端发起，进入 Easy Proxy 的处理流水线
            </div>
          </div>

          <div className="rounded-lg border bg-background/80 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              处理阶段
            </div>
            <div className="text-sm font-medium">{inspection.stages.length} 个阶段</div>
            <div className="text-xs text-muted-foreground mt-1">
              按实际执行顺序记录插件和系统模块对请求的处理
            </div>
          </div>

          <div className="rounded-lg border bg-background/80 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              {finalOutcome.icon}
              最终结果
            </div>
            <div className="text-sm font-medium">{finalOutcome.label}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {finalOutcome.description}
            </div>
          </div>
        </div>
      </div>

      {inspection.stages.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          无处理阶段信息（插件模式可能未开启）
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Flag className="h-3.5 w-3.5" />
            <span>默认仅展示改动内容；跳过阶段默认折叠，可单独展开查看更多。</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <StageColumn
              title="请求阶段"
              description="客户端请求进入代理后，按顺序执行请求侧处理阶段"
              stages={requestStages}
              icon={<Route className="h-4 w-4 text-blue-500" />}
              roleLabel="客户端"
              roleIcon={<Monitor className="h-3 w-3 text-blue-500" />}
              accentClass="text-blue-500"
            />
            <StageColumn
              title="响应阶段"
              description="服务器响应返回代理后，按顺序执行响应侧处理阶段"
              stages={responseStages}
              icon={<Activity className="h-4 w-4 text-emerald-500" />}
              roleLabel="服务器"
              roleIcon={<Server className="h-3 w-3 text-emerald-500" />}
              accentClass="text-emerald-500"
            />
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>请求进入</span>
            <ArrowRight className="h-4 w-4 animate-pulse text-blue-500" />
            <span>请求阶段</span>
            <ArrowRight className="h-4 w-4 animate-pulse text-violet-500" />
            <span>响应阶段</span>
            <ArrowRight className="h-4 w-4 animate-pulse text-emerald-500" />
            <span>最终返回</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function DetailPanel({ open = false, onClose, embedded = false, detail, loading, error, selectedRecord, onCreateMock, onReplay }: DetailPanelProps) {
  const [replaying, setReplaying] = useState(false)

  const handleCreateMock = () => {
    if (detail && selectedRecord && onCreateMock) {
      onCreateMock({
        source: selectedRecord.source,
        responseBody: detail.responseBody,
        statusCode: detail.statusCode,
        responseHeaders: detail.responseHeaders,
      })
    }
  }

  const [replayError, setReplayError] = useState<string | null>(null)

  const handleReplay = async () => {
    if (selectedRecord?.id != null && onReplay) {
      setReplaying(true)
      setReplayError(null)
      try {
        await onReplay(selectedRecord.id)
      } catch (err) {
        setReplayError((err as Error).message || '重放失败')
      } finally {
        setReplaying(false)
      }
    }
  }

  const body = (
    <>
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            请求详情
            {detail && (
              <Badge className={`${getStatusColor(detail.statusCode)} border-0`}>
                {detail.statusCode} {detail.statusMessage}
              </Badge>
            )}
            {selectedRecord?.clientType && (
              <Badge
                variant="outline"
                className="max-w-48 text-[10px] font-mono"
                title={[selectedRecord.clientName, selectedRecord.clientIp].filter(Boolean).join(' · ')}
              >
                {selectedRecord.clientName
                  || (selectedRecord.clientType === 'local'
                    ? '本机'
                    : selectedRecord.clientType === 'plugin'
                      ? '插件测试'
                      : '远程设备')}
                {selectedRecord.clientIp ? ` · ${selectedRecord.clientIp}` : ''}
              </Badge>
            )}
            {selectedRecord?.applicationName && (
              <Badge
                variant="outline"
                className="max-w-56 gap-1.5 text-[10px]"
                title={[
                  selectedRecord.applicationIdentitySource === 'local-process'
                    ? '识别方式: 本机进程'
                    : selectedRecord.applicationIdentitySource === 'user-agent'
                      ? '识别方式: User-Agent 推断'
                      : selectedRecord.applicationIdentitySource === 'client-reported'
                        ? '识别方式: 客户端上报'
                        : undefined,
                  selectedRecord.applicationIdentityConfidence
                    ? `可信度: ${selectedRecord.applicationIdentityConfidence === 'high' ? '高' : selectedRecord.applicationIdentityConfidence === 'medium' ? '中' : '低'}`
                    : undefined,
                  selectedRecord.applicationProcess,
                  selectedRecord.applicationPid ? `PID ${selectedRecord.applicationPid}` : undefined,
                  selectedRecord.applicationBundleId,
                  selectedRecord.applicationPath,
                ].filter(Boolean).join(' · ')}
              >
                <ApplicationIcon record={selectedRecord} compact />
                <span className="truncate">{selectedRecord.applicationName}</span>
                {selectedRecord.applicationIdentitySource === 'user-agent' && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">推断</span>
                )}
              </Badge>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              {detail && onReplay && selectedRecord?.id != null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleReplay}
                  disabled={replaying}
                  title="使用相同的请求参数重新发送请求"
                >
                  <RotateCw className={`h-3.5 w-3.5 mr-1 ${replaying ? 'animate-spin' : ''}`} />
                  {replaying ? '重放中...' : '重放'}
                </Button>
              )}
              {detail && onCreateMock && !selectedRecord?.mock && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleCreateMock}
                >
                  <Wand2 className="h-3.5 w-3.5 mr-1" />
                  创建 Mock
                </Button>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        <Separator />

        {replayError && (
          <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
            {replayError}
          </div>
        )}

        {error && !loading && !detail && (
          <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <Tabs defaultValue="request" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-4 mt-2 w-fit">
              <TabsTrigger value="request">请求</TabsTrigger>
              <TabsTrigger value="response">响应</TabsTrigger>
              <TabsTrigger value="inspect">
                <Activity className="h-3.5 w-3.5 mr-1" />
                Inspect
              </TabsTrigger>
            </TabsList>
            <TabsContent value="request" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full px-4 pb-4">
                <div className="space-y-3 pt-3">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Request Headers</h4>
                    <HeadersView headers={detail.requestHeaders} />
                  </div>
                  <Separator />
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Request Body</h4>
                    <BodyView body={detail.requestBody} />
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="response" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full px-4 pb-4">
                <div className="space-y-3 pt-3">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Response Headers</h4>
                    <HeadersView headers={detail.responseHeaders} />
                  </div>
                  <Separator />
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Response Body</h4>
                    <BodyView body={detail.responseBody} />
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="inspect" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full px-4 pb-4">
                {detail.inspection ? (
                  <InspectionView inspection={detail.inspection} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
                    <Activity className="h-12 w-12 mb-4 opacity-50" />
                    <p className="text-sm">无 Inspect 信息</p>
                    <p className="text-xs mt-1">
                      需要开启插件模式（on/shadow）才能查看请求生命周期
                    </p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-6 text-center">
            {selectedRecord ? (
              <div className="space-y-2">
                <div>详情数据暂不可用</div>
                <div className="text-xs font-mono break-all">
                  {selectedRecord.method} {selectedRecord.source}
                </div>
              </div>
            ) : (
              <div>无法加载详情</div>
            )}
          </div>
        )}
    </>
  )

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{body}</div>
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose?.()}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={640} storageKey="detail-panel">
        {body}
      </SheetContent>
    </Sheet>
  )
}

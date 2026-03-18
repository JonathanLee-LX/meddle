import { useState, useMemo } from 'react'
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
import { Loader2, Wand2, RotateCw, Activity, CheckCircle2, XCircle, AlertCircle, ArrowRight, Clock, CornerDownRight, Flag, Route, ShieldCheck } from 'lucide-react'
import { highlightCode } from '@/lib/syntax-highlight'
import type { RecordDetail, ProxyRecord, InspectionStage } from '@/types'

interface DetailPanelProps {
  open: boolean
  onClose: () => void
  detail: RecordDetail | null
  loading: boolean
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

function getStatusIcon(status: InspectionStage['status']) {
  switch (status) {
    case 'ok':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />
    case 'skipped':
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
    case 'short-circuited':
      return <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
    default:
      return null
  }
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
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-semibold">处理流程</h4>
              <p className="text-xs text-muted-foreground mt-1">
                按请求真实执行顺序展示，从进入代理到返回响应或继续转发
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              Timeline
            </Badge>
          </div>

          <div className="space-y-0">
          {inspection.stages.map((stage, index) => (
            <div
              key={`${stage.name}-${index}`}
              className="relative pl-10 pb-5 last:pb-0"
            >
              {index < inspection.stages.length - 1 && (
                <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
              )}
              <div className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm">
                {getStatusIcon(stage.status)}
              </div>

              <div className="rounded-xl border bg-background/90 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
                          : stage.status === 'skipped'
                            ? '这一阶段被跳过，没有对请求做实际处理。'
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

                {(stage.target || stage.changes) && (
                  <div className="grid gap-2 md:grid-cols-2">
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

                    {stage.changes && (
                      <div className="rounded-lg bg-muted/50 p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                          本阶段产出
                        </div>
                        <div className="space-y-1.5 text-xs">
                          {stage.changes.target && (
                            <div>
                              <span className="text-muted-foreground">改写目标: </span>
                              <span className="font-mono break-all">{stage.changes.target}</span>
                            </div>
                          )}
                          {stage.changes.responseStatusCode && (
                            <div>
                              <span className="text-muted-foreground">响应状态: </span>
                              <span className="font-mono">{stage.changes.responseStatusCode}</span>
                            </div>
                          )}
                          {stage.changes.responseHeaders && (
                            <div>
                              <span className="text-muted-foreground">响应头: </span>
                              <span className="font-mono">
                                {Object.keys(stage.changes.responseHeaders).join(', ') || '无'}
                              </span>
                            </div>
                          )}
                          {stage.changes.responseBody && (
                            <div>
                              <span className="text-muted-foreground">响应体摘要: </span>
                              <span className="font-mono break-all">
                                {stage.changes.responseBody.substring(0, 80)}
                                {stage.changes.responseBody.length > 80 ? '...' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {stage.error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Error: {stage.error}
                  </div>
                )}

                {index === inspection.stages.length - 1 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <Flag className="h-3.5 w-3.5" />
                    <span>流程在这一步之后结束</span>
                  </div>
                )}
                </div>
              </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function DetailPanel({ open, onClose, detail, loading, selectedRecord, onCreateMock, onReplay }: DetailPanelProps) {
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

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={640} storageKey="detail-panel">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            请求详情
            {detail && (
              <Badge className={`${getStatusColor(detail.statusCode)} border-0`}>
                {detail.statusCode} {detail.statusMessage}
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
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            无法加载详情
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

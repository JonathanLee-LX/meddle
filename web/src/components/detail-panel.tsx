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
import { Loader2, Wand2, RotateCw, Activity, CheckCircle2, XCircle, AlertCircle, ArrowRight, Clock } from 'lucide-react'
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

function InspectionView({ inspection }: { inspection: NonNullable<RecordDetail['inspection']> }) {
  return (
    <div className="space-y-4 pt-3">
      {/* 请求基本信息 */}
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

      <Separator />

      {/* 处理阶段列表 */}
      {inspection.stages.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          无处理阶段信息（插件模式可能未开启）
        </p>
      ) : (
        <div className="space-y-3">
          {inspection.stages.map((stage, index) => (
            <div
              key={`${stage.name}-${index}`}
              className="border rounded-lg p-3 space-y-2"
            >
              {/* 阶段头部 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(stage.status)}
                  <span className="font-medium text-sm">{stage.name}</span>
                  <Badge variant="outline" className="text-xs font-normal">
                    {stage.hook}
                  </Badge>
                  {stage.type !== 'system' && (
                    <Badge variant="outline" className="text-xs font-normal">
                      {stage.type}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs border ${getStatusBadgeVariant(stage.status)}`}>
                    {stage.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {stage.duration}ms
                  </span>
                </div>
              </div>

              {/* Target 变化 */}
              {stage.target && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Target: </span>
                  <span className="font-mono">{stage.target}</span>
                </div>
              )}

              {/* 变化详情 */}
              {stage.changes && (
                <div className="bg-muted/50 rounded p-2 space-y-1.5">
                  {stage.changes.target && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Target changed: </span>
                      <span className="font-mono">{stage.changes.target}</span>
                    </div>
                  )}
                  {stage.changes.responseStatusCode && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Status: </span>
                      <span className="font-mono">{stage.changes.responseStatusCode}</span>
                    </div>
                  )}
                  {stage.changes.responseHeaders && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Headers: </span>
                      <span className="font-mono">
                        {Object.keys(stage.changes.responseHeaders).join(', ')}
                      </span>
                    </div>
                  )}
                  {stage.changes.responseBody && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Body: </span>
                      <span className="font-mono truncate block max-w-xs">
                        {stage.changes.responseBody.substring(0, 50)}
                        {stage.changes.responseBody.length > 50 ? '...' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 错误信息 */}
              {stage.error && (
                <div className="text-xs text-red-600">
                  Error: {stage.error}
                </div>
              )}
            </div>
          ))}
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
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
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

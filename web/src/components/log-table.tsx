import { useRef, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown, ArrowUp, Inbox } from 'lucide-react'
import { ApplicationIcon } from '@/components/application-icon'
import { cn } from '@/lib/utils'
import type { ProxyRecord } from '@/types'

type TimeSortOrder = 'asc' | 'desc'

const tableBadgeClassName = 'h-[18px] px-[5px] py-0 font-mono text-[10px] leading-none'
const headerCellClassName = 'flex h-9 shrink-0 items-center px-2 leading-none'
const LOG_ROW_HEIGHT = 36
const LIVE_EDGE_THRESHOLD_PX = LOG_ROW_HEIGHT

interface LogTableProps {
  records: ProxyRecord[]
  selectedRecordId: number | null
  onSelect: (id: number) => void
  autoScroll: boolean
}

function getMethodVariant(method: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'default'
    case 'DELETE':
      return 'destructive'
    case 'GET':
      return 'secondary'
    default:
      return 'outline'
  }
}

function getStatusVariant(code: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (code >= 400) return 'destructive'
  if (code >= 300) return 'secondary'
  if (code >= 200) return 'default'
  return 'outline'
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getClientLabel(record: ProxyRecord) {
  if (record.clientType === 'local') return record.clientName || '本机'
  if (record.clientType === 'plugin') return record.clientName || '插件'
  if (record.clientType === 'remote') return record.clientName || '远程'
  return '未标记'
}

function getClientVariant(record: ProxyRecord): 'default' | 'secondary' | 'outline' {
  if (record.clientType === 'plugin') return 'default'
  if (record.clientType === 'remote') return 'secondary'
  return 'outline'
}

function getApplicationTitle(record: ProxyRecord) {
  return [
    record.applicationName,
    record.applicationIdentitySource === 'local-process'
      ? '识别方式: 本机进程'
      : record.applicationIdentitySource === 'user-agent'
        ? '识别方式: User-Agent 推断'
        : record.applicationIdentitySource === 'client-reported'
          ? '识别方式: 客户端上报'
          : undefined,
    record.applicationIdentityConfidence
      ? `可信度: ${record.applicationIdentityConfidence === 'high' ? '高' : record.applicationIdentityConfidence === 'medium' ? '中' : '低'}`
      : undefined,
    record.applicationProcess && record.applicationProcess !== record.applicationName
      ? `进程: ${record.applicationProcess}`
      : undefined,
    record.applicationPid ? `PID: ${record.applicationPid}` : undefined,
    record.applicationBundleId ? `Bundle ID: ${record.applicationBundleId}` : undefined,
    record.applicationPath,
  ].filter(Boolean).join('\n')
}

function isInferredApplication(record: ProxyRecord) {
  return record.applicationIdentitySource === 'user-agent'
}

export function LogTable({ records, selectedRecordId, onSelect, autoScroll }: LogTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(records.length)
  const followLiveEdgeRef = useRef(true)
  const [timeSortOrder, setTimeSortOrder] = useState<TimeSortOrder>('desc')

  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => {
      const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      return viewport as HTMLElement | null
    },
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()

  const toggleTimeSortOrder = () => {
    const nextOrder = timeSortOrder === 'desc' ? 'asc' : 'desc'
    followLiveEdgeRef.current = nextOrder === 'desc'
    setTimeSortOrder(nextOrder)
    virtualizer.scrollToOffset(0)
  }

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLElement)) return

    const updateFollowState = () => {
      followLiveEdgeRef.current = timeSortOrder === 'desc'
        ? viewport.scrollTop <= LIVE_EDGE_THRESHOLD_PX
        : viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= LIVE_EDGE_THRESHOLD_PX
    }

    updateFollowState()
    viewport.addEventListener('scroll', updateFollowState, { passive: true })
    return () => viewport.removeEventListener('scroll', updateFollowState)
  }, [timeSortOrder])

  useEffect(() => {
    if (autoScroll && followLiveEdgeRef.current && records.length > lastCountRef.current) {
      const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        requestAnimationFrame(() => {
          viewport.scrollTop = timeSortOrder === 'desc' ? 0 : viewport.scrollHeight
        })
      }
    }
    lastCountRef.current = records.length
  }, [records.length, autoScroll, timeSortOrder])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-x-auto">
      <div className="flex min-h-0 min-w-[1080px] flex-1 flex-col">
        {/* Header - Sticky */}
        <div className="z-10 flex h-9 shrink-0 items-stretch border-b bg-muted/70 text-xs font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/90">
          <div className={cn(headerCellClassName, 'w-16')}>方法</div>
          <div className={cn(headerCellClassName, 'w-14')}>状态</div>
          <div className={cn(headerCellClassName, 'w-24')}>来源</div>
          <div className={cn(headerCellClassName, 'w-44')}>应用</div>
          <div className={cn(headerCellClassName, 'min-w-[200px] flex-1')}>源地址</div>
          <div className={cn(headerCellClassName, 'min-w-[200px] flex-1')}>目标地址</div>
          <div className={cn(headerCellClassName, 'w-14')}>协议</div>
          <div className={cn(headerCellClassName, 'w-16')}>耗时</div>
          <div className={cn(headerCellClassName, 'w-28')}>
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleTimeSortOrder}
              className="-ml-2 h-7"
              title={timeSortOrder === 'desc' ? '倒序（新→旧），点击切换为正序' : '正序（旧→新），点击切换为倒序'}
            >
              时间
              {timeSortOrder === 'desc' ? <ArrowDown data-icon="inline-end" /> : <ArrowUp data-icon="inline-end" />}
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1" ref={scrollRef}>
          <div className="min-w-full">
            {/* Virtual List */}
            {records.length === 0 ? (
              <Empty className="min-h-72 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle>暂无请求记录</EmptyTitle>
                  <EmptyDescription>打开需要调试的页面后，请求会实时显示在这里。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const recordIndex = timeSortOrder === 'desc'
                    ? virtualRow.index
                    : records.length - 1 - virtualRow.index
                  const record = records[recordIndex]
                  const isSelected = selectedRecordId === record.id
                  return (
                    <div
                      key={record.id ?? virtualRow.index}
                      className={cn(
                        'absolute flex w-full items-center cursor-pointer border-b border-border/50 text-xs transition-colors',
                        isSelected ? 'bg-accent' : 'hover:bg-muted/50',
                      )}
                      onClick={() => record.id != null && onSelect(record.id)}
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="flex h-full w-16 items-center px-2">
                        <Badge variant={getMethodVariant(record.method)} className={tableBadgeClassName}>
                          {record.method}
                        </Badge>
                      </div>
                      <div className="flex h-full w-14 items-center px-2">
                        {record.statusCode != null && (
                          <Badge variant={getStatusVariant(record.statusCode)} className={tableBadgeClassName}>
                            {record.statusCode}
                          </Badge>
                        )}
                      </div>
                      <div
                        className="flex h-full w-24 items-center truncate px-2"
                        title={[record.clientName, record.clientIp].filter(Boolean).join(' · ') || '未标记来源'}
                      >
                        <Badge variant={getClientVariant(record)} className={cn(tableBadgeClassName, 'max-w-full')}>
                          <span className="truncate">{getClientLabel(record)}</span>
                        </Badge>
                      </div>
                      <div
                        className="flex h-full w-44 items-center gap-1.5 truncate px-2"
                        title={getApplicationTitle(record) || (record.clientType !== 'plugin' ? '未识别到请求应用' : '')}
                      >
                        {record.applicationName ? (
                          <>
                            <ApplicationIcon record={record} compact />
                            <span className="truncate">{record.applicationName}</span>
                            {isInferredApplication(record) && (
                              <span className="shrink-0 rounded border px-1 text-[9px] leading-4 text-muted-foreground">
                                推断
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="truncate text-muted-foreground">
                            {record.clientType === 'plugin' ? '—' : '未知应用'}
                          </span>
                        )}
                      </div>
                      <div className="flex h-full min-w-[200px] flex-1 items-center truncate px-2 font-mono" title={record.source}>
                        {record._fromPluginTest && (
                          <Badge variant="secondary" className={cn(tableBadgeClassName, 'mr-1')}>
                            插件测试
                          </Badge>
                        )}
                        {record.source}
                      </div>
                      <div className="flex h-full min-w-[200px] flex-1 items-center truncate px-2 font-mono" title={record.target}>
                        {record.mock && <Badge className={cn(tableBadgeClassName, 'mr-1')}>MOCK</Badge>}
                        {record.target}
                      </div>
                      <div className="flex h-full w-14 items-center px-2">
                        {record.protocol && (
                          <Badge variant={record.protocol === 'h2' ? 'secondary' : 'outline'} className={tableBadgeClassName}>
                            {record.protocol}
                          </Badge>
                        )}
                      </div>
                      <div className="flex h-full w-16 items-center px-2 font-mono text-[10px] text-muted-foreground">
                        {record.duration != null && formatDuration(record.duration)}
                      </div>
                      <div className="flex h-full w-28 items-center px-2 font-mono text-muted-foreground">{record.time}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

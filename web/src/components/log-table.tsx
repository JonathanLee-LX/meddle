import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown, ArrowUp, Inbox } from 'lucide-react'
import { ApplicationIcon } from '@/components/application-icon'
import { useTheme } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import type { ProxyRecord } from '@/types'
import { TrafficHitBadge } from '@/components/traffic-hit-badge'
import { useMediaQuery } from '@/hooks/use-media-query'
import { TRAFFIC_NARROW_MAX_WIDTH_PX } from '@/lib/traffic-split'

type TimeSortOrder = 'asc' | 'desc'
type LogLayout = 'full' | 'compact' | 'cards'

const COLUMNS = ['method', 'status', 'client', 'app', 'source', 'target', 'protocol', 'duration', 'time', 'hit'] as const
type ColumnId = (typeof COLUMNS)[number]

/** Wide detail pane: keep an index of method, status, and the source URL. */
const COMPACT_COLUMNS: ColumnId[] = ['method', 'status', 'source']

const COLUMN_LABEL: Record<ColumnId, string> = {
  method: '方法',
  status: '状态',
  client: '来源',
  app: '应用',
  source: '源地址',
  target: '目标地址',
  protocol: '协议',
  duration: '耗时',
  time: '时间',
  hit: '命中',
}

const tableBadgeClassName = 'h-[calc(16/14*1rem)] px-[calc(4/14*1rem)] py-0 font-mono text-[calc(10/14*1rem)] leading-none'
const headerCellClassName = 'flex h-7 shrink-0 items-center px-1.5 leading-none'
const rowFocusClassName = 'outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50'
/** Dense B-layout row height at 100% zoom (~20–22px → ~28–32 rows @ ~700px). */
export const LOG_ROW_HEIGHT = 22
/**
 * Two-line card at 100% zoom: method/status line plus a truncated URL line.
 * Scaled with the same zoom factor as the dense row so --app-scale stays in step.
 */
export const LOG_CARD_ROW_HEIGHT = 52

export function scaledLogRowHeight(zoom: number, cards = false) {
  return (cards ? LOG_CARD_ROW_HEIGHT : LOG_ROW_HEIGHT) * zoom
}

interface LogTableProps {
  records: ProxyRecord[]
  selectedRecordId: number | null
  onSelect: (id: number) => void
  autoScroll: boolean
  /** Wide layout only: hide secondary columns while the detail pane is open. */
  detailOpen?: boolean
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

function getStatusVariant(code: number): 'success' | 'secondary' | 'warning' | 'destructive' | 'outline' {
  if (code >= 500) return 'destructive'
  if (code >= 400) return 'warning'
  if (code >= 300) return 'secondary'
  if (code >= 200) return 'success'
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

function logRowLabel(record: ProxyRecord) {
  const parts = [record.method]
  if (record.statusCode != null) parts.push(String(record.statusCode))
  if (record.source) parts.push(record.source)
  return parts.join(' ')
}

function columnWidthClass(id: ColumnId, layout: 'full' | 'compact') {
  if (layout === 'compact' && id === 'source') return 'min-w-0 flex-1'
  switch (id) {
    case 'method':
      return 'w-16'
    case 'status':
      return 'w-14'
    case 'client':
      return 'w-24'
    case 'app':
      return 'w-44'
    case 'source':
      return 'min-w-[calc(200/14*1rem)] flex-1'
    case 'target':
      return 'min-w-[calc(200/14*1rem)] flex-1'
    case 'protocol':
      return 'w-14'
    case 'duration':
      return 'w-16'
    case 'time':
      return 'w-24'
    case 'hit':
      return 'w-14'
  }
}

export function LogTable({ records, selectedRecordId, onSelect, autoScroll, detailOpen = false }: LogTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(records.length)
  const followLiveEdgeRef = useRef(true)
  const pendingFocusRef = useRef<number | null>(null)
  const [timeSortOrder, setTimeSortOrder] = useState<TimeSortOrder>('desc')
  const { zoom } = useTheme()
  const isNarrow = useMediaQuery(`(max-width: ${TRAFFIC_NARROW_MAX_WIDTH_PX}px)`)
  const layout: LogLayout = isNarrow ? 'cards' : detailOpen ? 'compact' : 'full'
  const rowHeight = scaledLogRowHeight(zoom, layout === 'cards')
  const columns: ColumnId[] = layout === 'compact' ? COMPACT_COLUMNS : [...COLUMNS]

  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => {
      const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      return viewport as HTMLElement | null
    },
    estimateSize: () => rowHeight,
    overscan: 10,
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  useEffect(() => {
    virtualizerRef.current.measure()
  }, [rowHeight])

  useEffect(() => {
    const index = pendingFocusRef.current
    if (index == null) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-log-row-index="${index}"]`)
    if (!el) return
    pendingFocusRef.current = null
    el.focus()
  })

  const virtualItems = virtualizer.getVirtualItems()

  const toggleTimeSortOrder = () => {
    const nextOrder = timeSortOrder === 'desc' ? 'asc' : 'desc'
    followLiveEdgeRef.current = nextOrder === 'desc'
    setTimeSortOrder(nextOrder)
    virtualizer.scrollToOffset(0)
  }

  const focusRow = (visualIndex: number) => {
    pendingFocusRef.current = visualIndex
    virtualizer.scrollToIndex(visualIndex, { align: 'auto' })
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-log-row-index="${visualIndex}"]`)
    if (!el) return
    pendingFocusRef.current = null
    el.focus()
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, record: ProxyRecord, visualIndex: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (record.id != null) onSelect(record.id)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const last = Math.max(records.length - 1, 0)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown'
          ? Math.min(visualIndex + 1, last)
          : Math.max(visualIndex - 1, 0)
    focusRow(next)
  }

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLElement)) return

    const updateFollowState = () => {
      followLiveEdgeRef.current = timeSortOrder === 'desc'
        ? viewport.scrollTop <= rowHeight
        : viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= rowHeight
    }

    updateFollowState()
    viewport.addEventListener('scroll', updateFollowState, { passive: true })
    return () => viewport.removeEventListener('scroll', updateFollowState)
  }, [rowHeight, timeSortOrder])

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

  const timeSortTitle = timeSortOrder === 'desc' ? '倒序（新→旧），点击切换为正序' : '正序（旧→新），点击切换为倒序'

  const renderTimeSort = () => (
    <Button
      variant="ghost"
      size="xs"
      onClick={toggleTimeSortOrder}
      className="-ml-1 h-6 px-1.5 text-[calc(11/14*1rem)]"
      title={timeSortTitle}
    >
      时间
      {timeSortOrder === 'desc' ? <ArrowDown data-icon="inline-end" /> : <ArrowUp data-icon="inline-end" />}
    </Button>
  )

  const renderCell = (record: ProxyRecord, id: ColumnId) => {
    const width = columnWidthClass(id, layout === 'compact' ? 'compact' : 'full')
    switch (id) {
      case 'method':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-2', width)}>
            <Badge variant={getMethodVariant(record.method)} className={tableBadgeClassName}>
              {record.method}
            </Badge>
          </div>
        )
      case 'status':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-2', width)}>
            {record.statusCode != null && (
              <Badge variant={getStatusVariant(record.statusCode)} className={tableBadgeClassName}>
                {record.statusCode}
              </Badge>
            )}
          </div>
        )
      case 'client':
        return (
          <div
            role="cell"
            key={id}
            className={cn('flex h-full items-center truncate px-2', width)}
            title={[record.clientName, record.clientIp].filter(Boolean).join(' · ') || '未标记来源'}
          >
            <Badge variant={getClientVariant(record)} className={cn(tableBadgeClassName, 'max-w-full')}>
              <span className="truncate">{getClientLabel(record)}</span>
            </Badge>
          </div>
        )
      case 'app':
        return (
          <div
            role="cell"
            key={id}
            className={cn('flex h-full items-center gap-1.5 truncate px-2', width)}
            title={getApplicationTitle(record) || (record.clientType !== 'plugin' ? '未识别到请求应用' : '')}
          >
            {record.applicationName ? (
              <>
                <ApplicationIcon record={record} compact />
                <span className="truncate">{record.applicationName}</span>
                {isInferredApplication(record) && (
                  <span className="shrink-0 rounded border px-1 text-[calc(9/14*1rem)] leading-4 text-muted-foreground">
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
        )
      case 'source':
        return (
          <div
            role="cell"
            key={id}
            className={cn('flex h-full items-center truncate px-2 font-mono', width)}
            title={record.source}
          >
            {record._fromPluginTest && (
              <Badge variant="secondary" className={cn(tableBadgeClassName, 'mr-1')}>
                插件测试
              </Badge>
            )}
            {record.source}
          </div>
        )
      case 'target':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center truncate px-2 font-mono', width)} title={record.target}>
            {record.target}
          </div>
        )
      case 'protocol':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-2', width)}>
            {record.protocol && (
              <Badge variant={record.protocol === 'h2' ? 'secondary' : 'outline'} className={tableBadgeClassName}>
                {record.protocol}
              </Badge>
            )}
          </div>
        )
      case 'duration':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-2 font-mono text-[calc(10/14*1rem)] text-muted-foreground', width)}>
            {record.duration != null && formatDuration(record.duration)}
          </div>
        )
      case 'time':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-1.5 font-mono text-[calc(10/14*1rem)] text-muted-foreground', width)}>
            {record.time}
          </div>
        )
      case 'hit':
        return (
          <div role="cell" key={id} className={cn('flex h-full items-center px-1.5', width)}>
            <TrafficHitBadge record={record} />
          </div>
        )
    }
  }

  return (
    <div
      data-testid="log-table"
      data-layout={layout}
      role="table"
      aria-label="请求日志"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
    <div className={layout === 'full'
      ? 'meddle-thin-scroll relative flex min-h-0 flex-1 overflow-x-auto'
      : 'relative flex min-h-0 flex-1 overflow-x-hidden'}>
      <div
        data-testid="log-table-track"
        className={layout === 'full'
          ? 'flex min-h-0 min-w-[calc(960/14*1rem)] flex-1 flex-col'
          : 'flex min-h-0 w-full min-w-0 flex-1 flex-col'}
      >
        {layout === 'cards' ? (
          <>
            <div role="row" className="sr-only">
              <div role="columnheader">方法</div>
              <div role="columnheader">状态</div>
              <div role="columnheader">源地址</div>
            </div>
            <div className="z-10 flex h-7 shrink-0 items-center justify-between border-b bg-muted/70 px-2 text-[calc(11/14*1rem)] font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/90">
              <span>请求</span>
              {renderTimeSort()}
            </div>
          </>
        ) : (
          <div role="row" className="z-10 flex h-7 shrink-0 items-stretch border-b bg-muted/70 text-[calc(11/14*1rem)] font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/90">
            {columns.map((id) => (
              <div key={id} role="columnheader" className={cn(headerCellClassName, columnWidthClass(id, layout))}>
                {id === 'time' ? renderTimeSort() : COLUMN_LABEL[id]}
              </div>
            ))}
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1" ref={scrollRef}>
          <div className="min-w-full">
            {records.length === 0 ? (
              <div className="min-h-72 flex-1" />
            ) : (
              <div
                role="rowgroup"
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
                      role="row"
                      data-log-row-index={virtualRow.index}
                      data-testid="log-row"
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-label={logRowLabel(record)}
                      className={cn(
                        'absolute flex w-full cursor-pointer border-b border-border/40 text-[calc(11/14*1rem)] transition-colors',
                        rowFocusClassName,
                        layout === 'cards'
                          ? 'min-w-0 flex-col justify-center gap-1 overflow-hidden px-2 py-1'
                          : 'items-center',
                        layout === 'compact' && 'min-w-0',
                        isSelected ? 'bg-accent' : 'hover:bg-muted/50',
                      )}
                      onClick={() => record.id != null && onSelect(record.id)}
                      onKeyDown={(event) => onRowKeyDown(event, record, virtualRow.index)}
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {layout === 'cards' ? (
                        <>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Badge variant={getMethodVariant(record.method)} className={tableBadgeClassName}>
                              {record.method}
                            </Badge>
                            {record.statusCode != null && (
                              <Badge variant={getStatusVariant(record.statusCode)} className={tableBadgeClassName}>
                                {record.statusCode}
                              </Badge>
                            )}
                            <span className="min-w-0 truncate text-[calc(10/14*1rem)] text-muted-foreground">
                              {getClientLabel(record)}
                            </span>
                            <TrafficHitBadge record={record} className="shrink-0" />
                            <span className="ml-auto shrink-0 font-mono text-[calc(10/14*1rem)] text-muted-foreground">
                              {record.duration != null ? formatDuration(record.duration) : record.time}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-1">
                            {record._fromPluginTest && (
                              <Badge variant="secondary" className={cn(tableBadgeClassName, 'shrink-0')}>
                                插件测试
                              </Badge>
                            )}
                            <div
                              role="cell"
                              className="min-w-0 flex-1 truncate font-mono"
                              title={record.source}
                            >
                              {record.source}
                            </div>
                          </div>
                        </>
                      ) : (
                        columns.map((id) => renderCell(record, id))
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
    {records.length === 0 && (
      <div
        data-testid="log-table-empty"
        className="pointer-events-none absolute inset-x-0 top-7 overflow-hidden"
      >
        <Empty className="min-h-72 w-full min-w-0 max-w-full border-0 px-[var(--ui-section-gap)]">
          <EmptyHeader className="w-full min-w-0 max-w-full">
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>暂无请求记录</EmptyTitle>
            <EmptyDescription>打开需要调试的页面后，请求会实时显示在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )}
    </div>
  )
}

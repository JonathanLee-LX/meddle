import { useRef, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown, ArrowUp, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProxyRecord } from '@/types'

type TimeSortOrder = 'asc' | 'desc'

const tableBadgeClassName = 'h-[18px] px-[5px] py-0 font-mono text-[10px] leading-none'

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

export function LogTable({ records, selectedRecordId, onSelect, autoScroll }: LogTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(records.length)
  const [timeSortOrder, setTimeSortOrder] = useState<TimeSortOrder>('desc')

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const idA = a.id ?? 0
      const idB = b.id ?? 0
      return timeSortOrder === 'desc' ? idB - idA : idA - idB
    })
  }, [records, timeSortOrder])

  const rowHeight = 36

  const virtualizer = useVirtualizer({
    count: sortedRecords.length,
    getScrollElement: () => {
      const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      return viewport as HTMLElement | null
    },
    estimateSize: () => rowHeight,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (autoScroll && sortedRecords.length > lastCountRef.current) {
      const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        requestAnimationFrame(() => {
          viewport.scrollTop = 0
        })
      }
    }
    lastCountRef.current = sortedRecords.length
  }, [sortedRecords.length, autoScroll])

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (viewport && virtualItems.length > 0) {
        virtualizer.scrollToOffset(0)
      }
    }
  }, [timeSortOrder])

  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-[900px]">
        {/* Header - Sticky */}
        <div className="sticky top-0 z-10 flex border-b bg-muted/70 text-xs font-medium backdrop-blur supports-[backdrop-filter]:bg-muted/90">
          <div className="w-16 py-2 px-2">方法</div>
          <div className="w-14 py-2 px-2">状态</div>
          <div className="w-24 py-2 px-2">来源</div>
          <div className="flex-1 py-2 px-2 min-w-[200px]">源地址</div>
          <div className="flex-1 py-2 px-2 min-w-[200px]">目标地址</div>
          <div className="w-14 py-2 px-2">协议</div>
          <div className="w-16 py-2 px-2">耗时</div>
          <div className="w-28 py-2 px-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setTimeSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              className="-ml-2"
              title={timeSortOrder === 'desc' ? '倒序（新→旧），点击切换为正序' : '正序（旧→新），点击切换为倒序'}
            >
              时间
              {timeSortOrder === 'desc' ? <ArrowDown data-icon="inline-end" /> : <ArrowUp data-icon="inline-end" />}
            </Button>
          </div>
        </div>
        <ScrollArea className="h-[calc(100vh-16rem)]" ref={scrollRef}>
          <div className="min-w-full">
            {/* Virtual List */}
            {sortedRecords.length === 0 ? (
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
                  const record = sortedRecords[virtualRow.index]
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

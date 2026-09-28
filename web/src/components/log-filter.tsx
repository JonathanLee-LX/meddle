import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, X, Trash2, Pause, Play } from 'lucide-react'
import type { ClientSourceFilter, ResourceType } from '@/types'

interface LogFilterProps {
  filterText: string
  setFilterText: (text: string) => void
  resourceTypeFilter: ResourceType
  setResourceTypeFilter: (type: ResourceType) => void
  clientSourceFilter: ClientSourceFilter
  setClientSourceFilter: (source: ClientSourceFilter) => void
  totalCount: number
  filteredCount: number
  onClear: () => void
  recording: boolean
  onToggleRecording: () => void
}

const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fetch', label: 'Fetch/XHR' },
  { value: 'doc', label: 'Doc' },
  { value: 'css', label: 'CSS' },
  { value: 'js', label: 'JS' },
  { value: 'font', label: 'Font' },
  { value: 'img', label: 'Img' },
  { value: 'media', label: 'Media' },
  { value: 'manifest', label: 'Manifest' },
  { value: 'websocket', label: 'WS' },
  { value: 'wasm', label: 'Wasm' },
  { value: 'other', label: 'Other' },
]

const CLIENT_SOURCES: { value: ClientSourceFilter; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'local', label: '本机' },
  { value: 'remote', label: '远程设备' },
  { value: 'plugin', label: '插件测试' },
]

export function LogFilter({
  filterText,
  setFilterText,
  resourceTypeFilter,
  setResourceTypeFilter,
  clientSourceFilter,
  setClientSourceFilter,
  totalCount,
  filteredCount,
  onClear,
  recording,
  onToggleRecording,
}: LogFilterProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Search + actions — single dense row */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="proxy-log-filter"
            placeholder="过滤 method / url / status..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="h-8 pl-8 font-mono text-xs"
            aria-label="过滤代理请求"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
          {filterText && (
            <Button variant="ghost" size="icon-sm" onClick={() => setFilterText('')} title="清除搜索" aria-label="清除搜索">
              <X />
            </Button>
          )}
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {filterText || resourceTypeFilter !== 'all' || clientSourceFilter !== 'all' ? `${filteredCount} / ${totalCount}` : `${totalCount} 条`}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleRecording}
            title={recording ? '暂停记录' : '恢复记录'}
            aria-label={recording ? '暂停记录' : '恢复记录'}
          >
            {recording ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onClear}
            title="清空日志"
            aria-label="清空日志"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {/* Source Select + resource types — one compact filter row (scroll on narrow) */}
      <div
        data-testid="log-filter-source-type-row"
        className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto"
      >
        <Select
          value={clientSourceFilter}
          onValueChange={(value) => setClientSourceFilter(value as ClientSourceFilter)}
        >
          <SelectTrigger
            className="h-8 w-[7.5rem] shrink-0 text-xs"
            aria-label="流量来源"
            data-testid="log-filter-source-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {CLIENT_SOURCES.map((source) => (
                <SelectItem key={source.value} value={source.value} className="text-xs">
                  {source.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          value={resourceTypeFilter}
          onValueChange={(value) => {
            if (value) setResourceTypeFilter(value as ResourceType)
          }}
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-nowrap justify-start"
          aria-label="资源类型"
        >
          {RESOURCE_TYPES.map((type) => (
            <ToggleGroupItem key={type.value} value={type.value} className="shrink-0">
              {type.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}

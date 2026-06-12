import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
    <div className="flex flex-col gap-3">
      {/* Search and actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="proxy-log-filter"
            placeholder="过滤请求... (支持 method:GET domain:xxx client:iPhone ip:10.0.0.2)"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-9 font-mono"
            aria-label="过滤代理请求"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
          {filterText && (
            <Button variant="ghost" size="icon-sm" onClick={() => setFilterText('')} title="清除搜索" aria-label="清除搜索">
              <X />
            </Button>
          )}
          <Badge variant="secondary" className="shrink-0">
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

      {/* Resource type filters */}
      <div className="flex flex-col gap-2">
        <ToggleGroup
          type="single"
          value={clientSourceFilter}
          onValueChange={(value) => {
            if (value) setClientSourceFilter(value as ClientSourceFilter)
          }}
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap justify-start"
          aria-label="流量来源"
        >
          {CLIENT_SOURCES.map((source) => (
            <ToggleGroupItem key={source.value} value={source.value}>
              {source.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={resourceTypeFilter}
          onValueChange={(value) => {
            if (value) setResourceTypeFilter(value as ResourceType)
          }}
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap justify-start"
          aria-label="资源类型"
        >
          {RESOURCE_TYPES.map((type) => (
            <ToggleGroupItem key={type.value} value={type.value}>
              {type.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}

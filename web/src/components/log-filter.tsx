import { useEffect, useRef, useState, type RefObject } from 'react'
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

/** Used when chip boxes cannot be measured (tests without layout). */
export const CHIP_FADE_FALLBACK_PX = 24
/** Minimum fade when more chips exist but the clip falls in a hairline gap. */
export const CHIP_FADE_MIN_PX = 12

export interface ChipBox {
  left: number
  right: number
}

export interface ChipFadeInsets {
  leftInset: number
  rightInset: number
  /** Gradient length on the outer side of a covered chip. The rest of the inset is solid. */
  leftFade: number
  rightFade: number
}

/**
 * Resting clip for one horizontal chip row.
 * A chip that straddles the scrollport is covered from its own left edge, so the
 * label is not left half-visible. The fade itself sits in the gap before that chip.
 */
export function resolveChipFade(input: {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  chips: ChipBox[]
}): ChipFadeInsets {
  const { scrollLeft, clientWidth, scrollWidth, chips } = input
  const hiddenRight = scrollWidth - clientWidth - scrollLeft
  const viewLeft = scrollLeft
  const viewRight = scrollLeft + clientWidth
  const sorted = chips.filter((chip) => chip.right - chip.left > 0.5).sort((a, b) => a.left - b.left)

  if (sorted.length === 0) {
    return {
      leftInset: scrollLeft > 1 ? CHIP_FADE_FALLBACK_PX : 0,
      rightInset: hiddenRight > 1 ? CHIP_FADE_FALLBACK_PX : 0,
      leftFade: CHIP_FADE_FALLBACK_PX,
      rightFade: CHIP_FADE_FALLBACK_PX,
    }
  }

  const partialRight = sorted.find((chip) => chip.left < viewRight - 0.5 && chip.right > viewRight + 0.5)
  const partialLeft = sorted.find((chip) => chip.left < viewLeft - 0.5 && chip.right > viewLeft + 0.5)

  let rightInset = 0
  let rightFade = 0
  if (hiddenRight > 1) {
    if (partialRight) {
      const previous = [...sorted].reverse().find((chip) => chip.right <= partialRight.left + 0.5)
      // An oversized first chip cannot be covered without hiding the only visible control.
      const fadeStart = previous ? previous.right : viewRight - CHIP_FADE_FALLBACK_PX
      rightFade = Math.max(0, partialRight.left - fadeStart)
      rightInset = Math.max(0, viewRight - fadeStart)
    } else {
      const lastFull = [...sorted].reverse().find((chip) => chip.right <= viewRight + 0.5)
      const gutter = lastFull ? viewRight - lastFull.right : 0
      if (gutter > 1) {
        rightFade = gutter
        rightInset = gutter
      }
    }
    if (rightInset < CHIP_FADE_MIN_PX) {
      const lastFull = [...sorted].reverse().find((chip) => chip.right <= viewRight + 0.5)
      if (lastFull) {
        const half = lastFull.left + (lastFull.right - lastFull.left) / 2
        const fadeStart = Math.max(half, viewRight - CHIP_FADE_MIN_PX)
        rightInset = Math.max(rightInset, viewRight - fadeStart)
        rightFade = rightInset
      }
    }
  }

  let leftInset = 0
  let leftFade = 0
  if (scrollLeft > 1) {
    if (partialLeft) {
      const next = sorted.find((chip) => chip.left >= partialLeft.right - 0.5)
      const fadeEnd = next ? next.left : viewLeft + CHIP_FADE_FALLBACK_PX
      leftFade = Math.max(0, fadeEnd - partialLeft.right)
      leftInset = Math.max(0, fadeEnd - viewLeft)
    } else {
      leftInset = CHIP_FADE_FALLBACK_PX
      leftFade = CHIP_FADE_FALLBACK_PX
    }
  }

  return { leftInset, rightInset, leftFade, rightFade }
}

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
  const chipRowRef = useRef<HTMLDivElement>(null)
  const chipFade = useChipRowFade(chipRowRef)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Search + actions — single dense row */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="proxy-log-filter"
            placeholder="过滤 method / url / status…"
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
          <Badge variant="secondary" className="shrink-0 text-[calc(10/14*1rem)]">
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
      <div className="relative min-w-0">
        <div
          ref={chipRowRef}
          data-testid="log-filter-source-type-row"
          className="meddle-thin-scroll flex min-w-0 snap-x snap-proximity flex-nowrap items-center gap-1.5 overflow-x-auto"
        >
          <div className="snap-start" data-log-filter-chip="">
          <Select
            value={clientSourceFilter}
            onValueChange={(value) => setClientSourceFilter(value as ClientSourceFilter)}
          >
            <SelectTrigger
              className="h-8 w-auto max-w-[8rem] shrink-0 text-xs"
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
          </div>
          <div className="w-max shrink-0">
            <ToggleGroup
              type="single"
              value={resourceTypeFilter}
              onValueChange={(value) => {
                if (value) setResourceTypeFilter(value as ResourceType)
              }}
              variant="outline"
              size="sm"
              spacing={1}
              className="min-w-0 flex-1 flex-nowrap justify-start"
              aria-label="资源类型"
            >
              {RESOURCE_TYPES.map((type) => (
                <ToggleGroupItem key={type.value} value={type.value} data-log-filter-chip="" className="shrink-0 snap-start">
                  {type.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        {chipFade.leftInset > 1 && (
          <div
            aria-hidden
            data-testid="log-filter-fade-left"
            className="pointer-events-none absolute inset-y-0 left-0 z-[1] from-card"
            style={{ width: chipFade.leftInset, background: chipFadeBackground('left', chipFade.leftFade) }}
          />
        )}
        {chipFade.rightInset > 1 && (
          <div
            aria-hidden
            data-testid="log-filter-fade-right"
            className="pointer-events-none absolute inset-y-0 right-0 z-[1] from-card"
            style={{ width: chipFade.rightInset, background: chipFadeBackground('right', chipFade.rightFade) }}
          />
        )}
      </div>
    </div>
  )
}

function chipFadeBackground(side: 'left' | 'right', fadePx: number) {
  const solidAt = `${Math.max(0, fadePx)}px`
  if (side === 'right') {
    return `linear-gradient(to left, var(--card) calc(100% - ${solidAt}), transparent)`
  }
  return `linear-gradient(to right, var(--card) calc(100% - ${solidAt}), transparent)`
}

function measureChips(row: HTMLElement): ChipBox[] {
  const rowRect = row.getBoundingClientRect()
  return [...row.querySelectorAll<HTMLElement>('[data-log-filter-chip]')].map((chip) => {
    const rect = chip.getBoundingClientRect()
    const left = rect.left - rowRect.left + row.scrollLeft
    return { left, right: left + rect.width }
  })
}

function useChipRowFade(ref: RefObject<HTMLDivElement | null>) {
  const [fade, setFade] = useState<ChipFadeInsets>({ leftInset: 0, rightInset: 0, leftFade: 0, rightFade: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      setFade(resolveChipFade({
        scrollLeft: el.scrollLeft,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        chips: measureChips(el),
      }))
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    el.querySelectorAll('[data-log-filter-chip]').forEach((chip) => observer.observe(chip))
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [ref])

  return fade
}


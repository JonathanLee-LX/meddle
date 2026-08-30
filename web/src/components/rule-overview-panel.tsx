import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ListFilter, Power, RefreshCw, Search, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { rulesToEprc } from '@/utils/eprc-parser'
import type { RuleItem } from '@/types'

interface RuleOverviewEntry {
  pattern: string
  target: string
  rawRule: string
  rawTarget: string
  exclusions: string[]
  enabled: boolean
}

interface RuleOverviewFile {
  name: string
  enabled: boolean
  rules: RuleOverviewEntry[]
  error?: string
}

interface RuleOverviewMergedRule {
  pattern: string
  target: string
  rawRule: string
  rawTarget: string
  exclusions: string[]
  file: string
}

interface RuleOverviewConflictRecord {
  file: string
  target: string
  rawRule: string
  rawTarget: string
}

interface RuleOverviewConflict {
  pattern: string
  winner: RuleOverviewConflictRecord
  shadowed: RuleOverviewConflictRecord[]
}

interface RuleOverviewData {
  files: Array<{ name: string; enabled: boolean; ruleCount: number }>
  mergedRules: RuleOverviewMergedRule[]
  conflicts: RuleOverviewConflict[]
  perFileRules: RuleOverviewFile[]
}

export interface RuleOverviewPanelProps {
  rules: RuleItem[]
  activeFileName: string | null
  onLocateRule: (file: string, rule: string, target: string) => void
  onSelectFile: (file: string) => void
}

type OverviewView = 'merged' | 'files'

const CONFLICT_GROUP_CLASS = 'border-l-2 border-l-transparent'
const SHADOWED_ROW_CLASS = 'text-muted-foreground opacity-75'

function formatExclusions(exclusions: string[]): string {
  return exclusions.length > 0 ? exclusions.map((exclusion) => `!${exclusion}`).join(' ') : '—'
}

export function RuleOverviewPanel({ rules, activeFileName, onLocateRule, onSelectFile }: RuleOverviewPanelProps) {
  const [data, setData] = useState<RuleOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<OverviewView>('merged')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rule-files/overview')
      if (!res.ok) throw new Error(`加载失败（${res.status}）`)
      const json = (await res.json()) as RuleOverviewData
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 活动文件脏检查：编辑器内存规则与已保存内容不一致时提示
  const activeFile = useMemo(
    () => data?.perFileRules.find((file) => file.name === activeFileName) ?? null,
    [data, activeFileName],
  )
  const dirty = useMemo(() => {
    if (!activeFile || activeFile.error) return false
    const serverItems: RuleItem[] = activeFile.rules.map((entry) => ({
      rule: entry.rawRule,
      target: entry.rawTarget,
      enabled: entry.enabled,
      exclusions: entry.exclusions,
    }))
    return rulesToEprc(rules) !== rulesToEprc(serverItems)
  }, [activeFile, rules])

  const conflictsByPattern = useMemo(() => {
    const map = new Map<string, RuleOverviewConflict>()
    for (const conflict of data?.conflicts ?? []) map.set(conflict.pattern, conflict)
    return map
  }, [data])

  const matchesQuery = useCallback(
    (parts: Array<string | undefined>) => {
      const keyword = deferredQuery.trim().toLowerCase()
      if (!keyword) return true
      return parts.some((part) => part && part.toLowerCase().includes(keyword))
    },
    [deferredQuery],
  )

  // 生效视图：以「winner + 被覆盖行」为一组进行过滤
  const mergedGroups = useMemo(() => {
    return (data?.mergedRules ?? [])
      .map((rule) => {
        const conflict = conflictsByPattern.get(rule.pattern)
        return { winner: rule, shadowed: conflict?.shadowed ?? [] }
      })
      .filter(
        ({ winner, shadowed }) =>
          matchesQuery([winner.rawRule, winner.rawTarget, winner.file]) ||
          shadowed.some((record) => matchesQuery([record.rawRule, record.rawTarget, record.file])),
      )
  }, [data, conflictsByPattern, matchesQuery])

  const mergedTotal = data?.mergedRules.length ?? 0
  const mergedShadowedTotal = data?.conflicts.reduce((total, conflict) => total + conflict.shadowed.length, 0) ?? 0

  // 按文件视图：组内过滤；无匹配的组隐藏，出错/文件名命中的组保留
  const fileGroups = useMemo(() => {
    return (data?.perFileRules ?? [])
      .map((file) => ({
        ...file,
        matched: file.rules.filter((entry) => matchesQuery([entry.rawRule, entry.rawTarget, file.name])),
      }))
      .filter((file) => file.error != null || matchesQuery([file.name]) || file.matched.length > 0)
  }, [data, matchesQuery])

  const filesTotal = data?.perFileRules.reduce((total, file) => total + file.rules.length, 0) ?? 0
  const filesMatched = fileGroups.reduce((total, file) => total + file.matched.length, 0)

  const handleRowClick = useCallback(
    (file: string, rule: string, target: string) => {
      onLocateRule(file, rule, target)
    },
    [onLocateRule],
  )

  const handleGroupKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableCellElement>, file: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelectFile(file)
      }
    },
    [onSelectFile],
  )

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )
    }

    if (error) {
      return (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangle />
            </EmptyMedia>
            <EmptyTitle>加载失败</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </EmptyContent>
        </Empty>
      )
    }

    const hasFiles = (data?.files.length ?? 0) > 0
    const hasAnyRule = (data?.perFileRules.some((file) => file.rules.length > 0 || file.error != null) ?? false)
    const hasKeyword = deferredQuery.trim().length > 0

    if (!hasFiles) {
      return (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Table2 />
            </EmptyMedia>
            <EmptyTitle>还没有规则文件</EmptyTitle>
            <EmptyDescription>在路由规则页点击「+」创建第一个规则文件</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    if (!hasAnyRule) {
      return (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListFilter />
            </EmptyMedia>
            <EmptyTitle>所有规则文件都是空的</EmptyTitle>
            <EmptyDescription>还没有任何路由规则，先去路由规则页添加一条吧</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    if (view === 'merged' && !hasKeyword && (data?.mergedRules.length ?? 0) === 0) {
      return (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Power />
            </EmptyMedia>
            <EmptyTitle>没有生效中的规则</EmptyTitle>
            <EmptyDescription>规则全部被禁用，或没有启用任何规则文件；切换到「按文件」查看全部规则</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    if (hasKeyword && view === 'merged' && mergedGroups.length === 0) {
      return renderNoMatch()
    }
    if (hasKeyword && view === 'files' && fileGroups.every((file) => file.matched.length === 0 && file.error == null)) {
      return renderNoMatch()
    }

    if (view === 'merged') {
      return renderMergedTable()
    }
    return renderFilesTable()
  }

  const renderNoMatch = () => (
    <Empty className="min-h-0 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>无匹配结果</EmptyTitle>
        <EmptyDescription>没有找到符合「{deferredQuery.trim()}」的规则</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => setQuery('')}>
          清空筛选
        </Button>
      </EmptyContent>
    </Empty>
  )

  const renderMergedTable = () => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
      <div className="shrink-0 overflow-x-auto bg-card">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '6rem' }} />
            <col />
            <col style={{ width: '8rem' }} />
            <col />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>来源</TableHead>
              <TableHead>规则</TableHead>
              <TableHead className="hidden md:table-cell">排除</TableHead>
              <TableHead>目标</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '6rem' }} />
            <col />
            <col style={{ width: '8rem' }} />
            <col />
          </colgroup>
          <TableBody>
            {mergedGroups.map(({ winner, shadowed }) => (
              <Fragment key={`merged-group-${winner.pattern}`}>
                <TableRow
                  className={`${CONFLICT_GROUP_CLASS} cursor-pointer`}
                  onClick={() => handleRowClick(winner.file, winner.rawRule, winner.rawTarget)}
                  title="点击定位到该规则"
                >
                  <TableCell className="truncate text-xs text-muted-foreground">{winner.file}</TableCell>
                  <TableCell className="break-all font-mono text-xs">
                    {winner.rawRule}
                    {shadowed.length > 0 && (
                      <Badge variant="default" className="ml-2 px-1 py-0 text-[10px]" title="同名规则最终生效的定义">
                        生效
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden break-all font-mono text-xs text-muted-foreground md:table-cell">
                    {formatExclusions(winner.exclusions)}
                  </TableCell>
                  <TableCell className="break-all font-mono text-xs">{winner.rawTarget}</TableCell>
                </TableRow>
                {shadowed.map((record, index) => (
                  <TableRow
                    key={`merged-shadowed-${index}`}
                    className={`${CONFLICT_GROUP_CLASS} cursor-pointer ${SHADOWED_ROW_CLASS}`}
                    onClick={() => handleRowClick(record.file, record.rawRule, record.rawTarget)}
                    title="点击定位到该规则"
                  >
                    <TableCell className="truncate text-xs">{record.file}</TableCell>
                    <TableCell className="break-all font-mono text-xs">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {record.rawRule}
                        <Badge
                          variant="destructive"
                          className="px-1 py-0 text-[10px]"
                          title={`已被 ${winner.file} 中的同名规则覆盖，实际不生效`}
                        >
                          已被覆盖
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="hidden break-all font-mono text-xs md:table-cell">—</TableCell>
                    <TableCell className="break-all font-mono text-xs">{record.rawTarget}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )

  const renderFilesTable = () => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
      <div className="shrink-0 overflow-x-auto bg-card">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '3.5rem' }} />
            <col />
            <col style={{ width: '8rem' }} />
            <col />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead>规则</TableHead>
              <TableHead className="hidden md:table-cell">排除</TableHead>
              <TableHead>目标</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '3.5rem' }} />
            <col />
            <col style={{ width: '8rem' }} />
            <col />
          </colgroup>
          <TableBody>
            {fileGroups.map((file) => (
              <Fragment key={`file-group-${file.name}`}>
                <TableRow className="hover:bg-accent/60">
                  <TableCell
                    colSpan={4}
                    className="cursor-pointer bg-muted/50 p-2 align-middle"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectFile(file.name)}
                    onKeyDown={(event) => handleGroupKeyDown(event, file.name)}
                    title="点击切换到该规则文件"
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {file.name}
                      <Badge variant={file.enabled ? 'default' : 'secondary'} className="px-1 py-0 text-[10px]">
                        {file.enabled ? '启用' : '禁用'}
                      </Badge>
                      <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                        {file.rules.length}
                      </Badge>
                    </span>
                  </TableCell>
                </TableRow>
                {file.error && (
                  <TableRow className="text-destructive">
                    <TableCell colSpan={4} className="p-2 text-xs">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        读取失败：{file.error}
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {file.matched.map((entry, index) => (
                  <TableRow
                    key={`file-rule-${index}`}
                    className={`cursor-pointer ${entry.enabled ? '' : 'opacity-60'}`}
                    onClick={() => handleRowClick(file.name, entry.rawRule, entry.rawTarget)}
                    title="点击定位到该规则"
                  >
                    <TableCell>
                      <Badge variant={entry.enabled ? 'default' : 'secondary'} className="px-1 py-0 text-[10px]">
                        {entry.enabled ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="break-all font-mono text-xs">{entry.rawRule}</TableCell>
                    <TableCell className="hidden break-all font-mono text-xs text-muted-foreground md:table-cell">
                      {formatExclusions(entry.exclusions)}
                    </TableCell>
                    <TableCell className={`break-all font-mono text-xs ${entry.enabled ? '' : 'line-through'}`}>
                      {entry.rawTarget}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )

  const totalCount = view === 'merged' ? mergedTotal + mergedShadowedTotal : filesTotal
  const shownCount = view === 'merged' ? mergedGroups.reduce((total, group) => total + 1 + group.shadowed.length, 0) : filesMatched

  return (
    <div className="app-panel-content flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value) setView(value as OverviewView)
          }}
          variant="outline"
          size="sm"
          className="bg-background"
          aria-label="总览视图"
        >
          <ToggleGroupItem value="merged">生效规则</ToggleGroupItem>
          <ToggleGroupItem value="files">按文件</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索规则 / 目标 / 文件名"
            className="h-8 pl-8"
            aria-label="搜索规则"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="刷新总览"
          title="刷新"
        >
          <RefreshCw />
        </Button>
      </div>

      {dirty && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            「{activeFileName}」有未保存修改，此处展示的是代理当前使用的<b>已保存内容</b>
          </span>
        </div>
      )}

      {!loading && !error && (data?.files.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {shownCount} / {totalCount} 条
            {view === 'merged' && deferredQuery.trim() === '' && mergedShadowedTotal > 0
              ? `，其中 ${mergedShadowedTotal} 条被同名规则覆盖`
              : ''}
          </span>
          {view === 'merged' && <span>按代理实际生效顺序排列（后定义覆盖先定义）</span>}
          {view === 'files' && <span>点击文件名切换到该文件</span>}
        </div>
      )}

      {renderBody()}
    </div>
  )
}

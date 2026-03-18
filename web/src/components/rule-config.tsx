import { useEffect, useCallback, useMemo, useRef, useState, memo, useTransition, useDeferredValue } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Save, Trash2, Layers, Filter, X, GripVertical, ArrowUpToLine, FolderOpen, ToggleLeft, ToggleRight } from 'lucide-react'
import type { RuleItem, RuleFile } from '@/types'
import { Badge } from '@/components/ui/badge'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildRuleGraph } from '@/utils/rule-graph'
import { RouteCanvas } from '@/components/route-canvas'

interface RuleConfigProps {
  rules: RuleItem[]
  setRules: React.Dispatch<React.SetStateAction<RuleItem[]>>
  ruleFiles: RuleFile[]
  activeFileName: string | null
  fetchRuleFiles: () => Promise<RuleFile[]>
  fetchFileContent: (name: string) => Promise<void>
  saveFileContent: (name: string, items: RuleItem[]) => Promise<boolean>
  createRuleFile: (name: string, content?: string) => Promise<{ success: boolean; error?: string }>
  toggleRuleFile: (name: string, enabled: boolean) => Promise<boolean>
  deleteRuleFile: (name: string) => Promise<boolean>
}

interface SortableRuleRowProps {
  id: string
  item: RuleItem
  highlighted: boolean
  highlightRef: React.RefObject<HTMLTableRowElement | null>
  onToggle: () => void
  onUpdateRule: (field: 'rule' | 'target', value: string) => void
  onDelete: () => void
  onMoveToTop: () => void
}

const SortableRuleRow = memo(function SortableRuleRow({
  id,
  item,
  highlighted,
  highlightRef,
  onToggle,
  onUpdateRule,
  onDelete,
  onMoveToTop,
}: SortableRuleRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleToggle = useCallback(() => onToggle(), [onToggle])
  const handleUpdateRule = useCallback((field: 'rule' | 'target') => (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateRule(field, e.target.value)
  }, [onUpdateRule])
  const handleDelete = useCallback(() => onDelete(), [onDelete])
  const handleMoveToTop = useCallback(() => onMoveToTop(), [onMoveToTop])

  return (
    <TableRow
      ref={(node) => {
        setNodeRef(node)
        if (highlighted && highlightRef) {
          highlightRef.current = node
        }
      }}
      style={style}
      className={highlighted ? 'bg-amber-100/60 dark:bg-amber-500/20 transition-colors' : undefined}
    >
      <TableCell className="w-8 cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </TableCell>
      <TableCell className="w-12">
        <Checkbox checked={item.enabled} onCheckedChange={handleToggle} />
      </TableCell>
      <TableCell>
        <Input value={item.rule} onChange={handleUpdateRule('rule')} placeholder="example.com" className="h-8" />
      </TableCell>
      <TableCell>
        <Input value={item.target} onChange={handleUpdateRule('target')} placeholder="127.0.0.1:3000" className="h-8" />
      </TableCell>
      <TableCell className="w-24">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={handleMoveToTop} className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="置顶">
            <ArrowUpToLine className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDelete} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}, (prevProps, nextProps) => {
  return prevProps.item === nextProps.item && prevProps.highlighted === nextProps.highlighted && prevProps.id === nextProps.id
})

interface FilteredRuleRowProps {
  item: RuleItem
  highlighted: boolean
  highlightRef: React.RefObject<HTMLTableRowElement | null>
  onToggle: () => void
  onUpdateRule: (field: 'rule' | 'target', value: string) => void
  onDelete: () => void
  onMoveToTop: () => void
}

const FilteredRuleRow = memo(function FilteredRuleRow({
  item,
  highlighted,
  highlightRef,
  onToggle,
  onUpdateRule,
  onDelete,
  onMoveToTop,
}: FilteredRuleRowProps) {
  const handleToggle = useCallback(() => onToggle(), [onToggle])
  const handleUpdateRule = useCallback((field: 'rule' | 'target') => (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateRule(field, e.target.value)
  }, [onUpdateRule])
  const handleDelete = useCallback(() => onDelete(), [onDelete])
  const handleMoveToTop = useCallback(() => onMoveToTop(), [onMoveToTop])

  return (
    <TableRow
      ref={highlighted ? highlightRef : undefined}
      className={highlighted ? 'bg-amber-100/60 dark:bg-amber-500/20 transition-colors' : undefined}
    >
      <TableCell><Checkbox checked={item.enabled} onCheckedChange={handleToggle} /></TableCell>
      <TableCell><Input value={item.rule} onChange={handleUpdateRule('rule')} placeholder="example.com" className="h-8" /></TableCell>
      <TableCell><Input value={item.target} onChange={handleUpdateRule('target')} placeholder="127.0.0.1:3000" className="h-8" /></TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={handleMoveToTop} className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="置顶"><ArrowUpToLine className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={handleDelete} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </TableCell>
    </TableRow>
  )
}, (prevProps, nextProps) => prevProps.item === nextProps.item && prevProps.highlighted === nextProps.highlighted)

interface GroupedRuleRowProps {
  group: { key: string; target: string; indices: number[]; rules: string[]; enabledState: boolean | 'indeterminate' }
  highlighted: boolean
  highlightRef: React.RefObject<HTMLTableRowElement | null>
  onToggleGroup: () => void
  onUpdateGroupRules: (input: string) => void
  onUpdateGroupTarget: (target: string) => void
  onDeleteGroup: () => void
}

const GroupedRuleRow = memo(function GroupedRuleRow({
  group, highlighted, highlightRef, onToggleGroup, onUpdateGroupRules, onUpdateGroupTarget, onDeleteGroup,
}: GroupedRuleRowProps) {
  const handleToggle = useCallback(() => onToggleGroup(), [onToggleGroup])
  const handleUpdateRules = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onUpdateGroupRules(e.target.value), [onUpdateGroupRules])
  const handleUpdateTarget = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onUpdateGroupTarget(e.target.value), [onUpdateGroupTarget])
  const handleDelete = useCallback(() => onDeleteGroup(), [onDeleteGroup])

  return (
    <TableRow ref={highlighted ? highlightRef : undefined} className={highlighted ? 'bg-amber-100/60 dark:bg-amber-500/20 transition-colors' : undefined}>
      <TableCell><Checkbox checked={group.enabledState} onCheckedChange={handleToggle} /></TableCell>
      <TableCell><Input value={group.rules.filter(Boolean).join(' ')} onChange={handleUpdateRules} placeholder="example.com api.example.com" className="h-8" /></TableCell>
      <TableCell><Input value={group.target} onChange={handleUpdateTarget} placeholder="127.0.0.1:3000" className="h-8" /></TableCell>
      <TableCell><Button variant="ghost" size="sm" onClick={handleDelete} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></TableCell>
    </TableRow>
  )
}, (prevProps, nextProps) => prevProps.group === nextProps.group && prevProps.highlighted === nextProps.highlighted)

export function RuleConfig(props: RuleConfigProps) {
  const {
    rules, setRules,
    ruleFiles, activeFileName,
    fetchRuleFiles, fetchFileContent, saveFileContent,
    createRuleFile, toggleRuleFile, deleteRuleFile,
  } = props

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [mergeByTarget, setMergeByTarget] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'graph'>('graph')
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  // 创建规则文件
  const [isCreating, setIsCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('默认规则')
  const [createError, setCreateError] = useState<string | null>(null)

  // 从文件加载
  const [isImporting, setIsImporting] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // 筛选
  const [showFilters, setShowFilters] = useState(false)
  const [ruleFilter, setRuleFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const deferredRuleFilter = useDeferredValue(ruleFilter)
  const deferredTargetFilter = useDeferredValue(targetFilter)
  const [isPending, startTransition] = useTransition()

  // 初始化：加载文件列表并选中第一个
  useEffect(() => {
    fetchRuleFiles().then(files => {
      if (files.length > 0 && !activeFileName) {
        const enabledFile = files.find(f => f.enabled) || files[0]
        fetchFileContent(enabledFile.name)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换文件
  const handleSelectFile = useCallback(async (name: string) => {
    await fetchFileContent(name)
  }, [fetchFileContent])

  // 创建新规则文件
  const handleCreate = useCallback(async () => {
    if (!newFileName.trim()) return
    setCreateError(null)
    const result = await createRuleFile(newFileName.trim(), importContent || '')
    if (result.success) {
      setIsCreating(false)
      setIsImporting(false)
      setImportContent(null)
      setNewFileName('默认规则')
      await fetchFileContent(newFileName.trim())
    } else {
      setCreateError(result.error || '创建失败')
    }
  }, [createRuleFile, newFileName, importContent, fetchFileContent])

  // 从文件导入 → 创建新规则文件
  const handleImportFile = useCallback(async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [{ description: '规则文件', accept: { 'text/plain': ['.txt', '.rules'] } }],
          multiple: false,
        })
        const file = await fileHandle.getFile()
        const content = await file.text()
        const baseName = file.name.replace(/\.[^.]+$/, '')
        setImportContent(content)
        setImportName(baseName)
        setNewFileName(baseName)
        setIsImporting(true)
        setIsCreating(true)
        return
      } catch { /* cancelled */ }
    }
    importFileRef.current?.click()
  }, [])

  const handleImportInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      file.text().then(content => {
        const baseName = file.name.replace(/\.[^.]+$/, '')
        setImportContent(content)
        setImportName(baseName)
        setNewFileName(baseName)
        setIsImporting(true)
        setIsCreating(true)
      })
    }
    e.target.value = ''
  }, [])

  // 保存当前文件
  const handleSave = useCallback(async () => {
    if (!activeFileName) return
    setSaving(true)
    setSaveStatus('idle')
    const ok = await saveFileContent(activeFileName, rules)
    setSaving(false)
    setSaveStatus(ok ? 'success' : 'error')
    setTimeout(() => setSaveStatus('idle'), 2000)
    if (ok) fetchRuleFiles()
  }, [activeFileName, rules, saveFileContent, fetchRuleFiles])

  // 删除规则文件
  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`确定要删除规则文件「${name}」吗？`)) return
    await deleteRuleFile(name)
  }, [deleteRuleFile])

  // 规则编辑操作
  const toggleRule = useCallback((index: number) => {
    startTransition(() => setRules(prev => prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))))
  }, [setRules])

  const updateRule = useCallback((index: number, field: 'rule' | 'target', value: string) => {
    setRules(prev => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }, [setRules])

  const deleteRule = useCallback((index: number) => {
    startTransition(() => setRules(prev => prev.filter((_, i) => i !== index)))
  }, [setRules])

  const addRule = useCallback(() => {
    startTransition(() => setRules(prev => [{ enabled: true, rule: '', target: '' }, ...prev]))
    setHighlightIndex(0)
  }, [setRules])

  const moveToTop = useCallback((index: number) => {
    startTransition(() => setRules(prev => { const n = [...prev]; const [item] = n.splice(index, 1); n.unshift(item); return n }))
    setHighlightIndex(0)
  }, [setRules])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setRules(prev => {
        const oldIndex = prev.findIndex((_, i) => `rule-${i}` === active.id)
        const newIndex = prev.findIndex((_, i) => `rule-${i}` === over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }, [setRules])

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  useEffect(() => {
    if (highlightIndex == null) return
    const raf = requestAnimationFrame(() => { highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
    const timer = setTimeout(() => setHighlightIndex(null), 1600)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [rules, highlightIndex, mergeByTarget])

  const parseRuleInput = useCallback((value: string) => value.split(/[\s,]+/).map(p => p.trim()).filter(Boolean), [])

  type RuleGroup = { key: string; target: string; indices: number[]; rules: string[]; enabledState: boolean | 'indeterminate' }

  const filteredRules = useMemo(() => {
    if (!deferredRuleFilter && !deferredTargetFilter) return rules.map((item, index) => ({ item, index }))
    const lr = deferredRuleFilter.toLowerCase()
    const lt = deferredTargetFilter.toLowerCase()
    return rules.map((item, index) => ({ item, index })).filter(({ item }) => {
      return (!deferredRuleFilter || item.rule.toLowerCase().includes(lr)) && (!deferredTargetFilter || item.target.toLowerCase().includes(lt))
    })
  }, [rules, deferredRuleFilter, deferredTargetFilter])

  const uniqueTargets = useMemo(() => {
    const targets = new Set<string>()
    rules.forEach(item => { if (item.target.trim()) targets.add(item.target.trim()) })
    return Array.from(targets).sort()
  }, [rules])

  const groupedRules = useMemo<RuleGroup[]>(() => {
    const groups = new Map<string, RuleGroup>()
    filteredRules.forEach(({ item, index: originalIndex }) => {
      const nt = item.target.trim()
      const key = nt === '' ? `__EMPTY__${originalIndex}` : nt
      const existing = groups.get(key)
      if (!existing) { groups.set(key, { key, target: item.target, indices: [originalIndex], rules: [item.rule], enabledState: item.enabled }); return }
      existing.indices.push(originalIndex)
      existing.rules.push(item.rule)
    })
    return Array.from(groups.values()).map(group => {
      const cnt = group.indices.reduce((c, idx) => c + (rules[idx].enabled ? 1 : 0), 0)
      let s: boolean | 'indeterminate' = false
      if (cnt === 0) s = false; else if (cnt === group.indices.length) s = true; else s = 'indeterminate'
      return { ...group, enabledState: s }
    })
  }, [filteredRules, rules])

  const graphData = useMemo(() => {
    return buildRuleGraph(rules, filteredRules.map(({ index }) => index))
  }, [rules, filteredRules])

  const toggleGroup = useCallback((indices: number[], enabledState: boolean | 'indeterminate') => {
    startTransition(() => { const next = enabledState !== true; const s = new Set(indices); setRules(prev => prev.map((item, idx) => (s.has(idx) ? { ...item, enabled: next } : item))) })
  }, [setRules])

  const updateGroupTarget = useCallback((indices: number[], target: string) => {
    const s = new Set(indices); setRules(prev => prev.map((item, idx) => (s.has(idx) ? { ...item, target } : item)))
  }, [setRules])

  const updateGroupRules = useCallback((indices: number[], input: string) => {
    const nextRules = parseRuleInput(input)
    startTransition(() => {
      setRules(prev => {
        const sorted = [...indices].sort((a, b) => a - b)
        const first = prev[sorted[0]]
        if (!first) return prev
        const replacement = (nextRules.length > 0 ? nextRules : ['']).map(rule => ({ enabled: first.enabled, target: first.target, rule }))
        const removeSet = new Set(sorted)
        const result: RuleItem[] = []
        prev.forEach((item, idx) => { if (idx === sorted[0]) { result.push(...replacement); return } if (!removeSet.has(idx)) result.push(item) })
        return result
      })
    })
  }, [parseRuleInput, setRules])

  const deleteGroup = useCallback((indices: number[]) => {
    startTransition(() => { const s = new Set(indices); setRules(prev => prev.filter((_, idx) => !s.has(idx))) })
  }, [setRules])

  const createToggleRuleCallback = useCallback((index: number) => () => toggleRule(index), [toggleRule])
  const createUpdateRuleCallback = useCallback((index: number) => (field: 'rule' | 'target', value: string) => updateRule(index, field, value), [updateRule])
  const createDeleteRuleCallback = useCallback((index: number) => () => deleteRule(index), [deleteRule])
  const createMoveToTopCallback = useCallback((index: number) => () => moveToTop(index), [moveToTop])
  const createToggleGroupCallback = useCallback((indices: number[], enabledState: boolean | 'indeterminate') => () => toggleGroup(indices, enabledState), [toggleGroup])
  const createUpdateGroupRulesCallback = useCallback((indices: number[]) => (input: string) => updateGroupRules(indices, input), [updateGroupRules])
  const createUpdateGroupTargetCallback = useCallback((indices: number[]) => (target: string) => updateGroupTarget(indices, target), [updateGroupTarget])
  const createDeleteGroupCallback = useCallback((indices: number[]) => () => deleteGroup(indices), [deleteGroup])

  return (
    <div className="space-y-4">
      {/* 规则文件 Tab 切换 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs value={activeFileName || ''} onValueChange={(val) => {
          if (val === '__create__') {
            setIsCreating(true)
            setImportContent(null)
          } else {
            handleSelectFile(val)
          }
        }}>
          <TabsList className="flex-wrap h-auto gap-1">
            {ruleFiles.map((rf) => (
              <TabsTrigger key={rf.name} value={rf.name} className="relative group gap-1.5">
                <button
                  className="shrink-0"
                  onClick={(e) => { e.stopPropagation(); toggleRuleFile(rf.name, !rf.enabled) }}
                  title={rf.enabled ? '点击禁用路由' : '点击启用路由'}
                >
                  {rf.enabled ? (
                    <ToggleRight className="h-4 w-4 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <span>{rf.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1 py-0">{rf.ruleCount}</Badge>
                {ruleFiles.length > 1 && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); handleDelete(rf.name) }}
                    title="删除规则文件"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="__create__" className="w-8">
              <Plus className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 创建/导入规则文件对话框 */}
      {isCreating && (
        <div className="rounded-md border p-3 bg-muted/30 space-y-2">
          <p className="text-sm font-medium">{isImporting ? '从文件导入为新规则' : '创建新规则文件'}</p>
          {isImporting && importName && (
            <p className="text-xs text-muted-foreground">导入自: {importName}</p>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={newFileName}
              onChange={(e) => { setNewFileName(e.target.value); setCreateError(null) }}
              placeholder="规则文件名称"
              className="h-8 w-48"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setIsCreating(false); setIsImporting(false); setImportContent(null); setCreateError(null) }
              }}
            />
            <Button size="sm" onClick={handleCreate}>创建</Button>
            <Button size="sm" variant="ghost" onClick={() => { setIsCreating(false); setIsImporting(false); setImportContent(null); setCreateError(null) }}>取消</Button>
          </div>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          {isPending && (
            <div className="text-xs text-muted-foreground">(更新中...)</div>
          )}
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'table' | 'graph')}>
            <TabsList variant="line">
              <TabsTrigger value="table">表格视图</TabsTrigger>
              <TabsTrigger value="graph">图表视图</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={showFilters ? 'default' : 'outline'} size="sm" onClick={() => setShowFilters(v => !v)} title="显示/隐藏筛选器">
            <Filter className="h-4 w-4 mr-1" />筛选
          </Button>
          {viewMode === 'table' && (
            <>
              <Button variant={mergeByTarget ? 'default' : 'outline'} size="sm" onClick={() => setMergeByTarget(v => !v)} title="将同一目标的规则合并为一条记录">
                <Layers className="h-4 w-4 mr-1" />{mergeByTarget ? '已按目标合并' : '按目标合并'}
              </Button>
              <Button variant="outline" size="sm" onClick={addRule} disabled={!activeFileName}>
                <Plus className="h-4 w-4 mr-1" />添加规则
              </Button>
              <input ref={importFileRef} type="file" accept=".txt,.rules" className="hidden" onChange={handleImportInputChange} />
              <Button variant="outline" size="sm" onClick={handleImportFile}>
                <FolderOpen className="h-4 w-4 mr-1" />从文件加载
              </Button>
              {activeFileName && (
                <>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    <Save className="h-4 w-4 mr-1" />{saving ? '保存中...' : '保存'}
                  </Button>
                  {saveStatus === 'success' && <span className="text-sm text-green-600 self-center">已保存</span>}
                  {saveStatus === 'error' && <span className="text-sm text-red-600 self-center">保存失败</span>}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 筛选器 */}
      {showFilters && (
        <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-md">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">筛选规则</label>
            <div className="relative">
              <Input value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} placeholder="输入规则名称进行筛选..." className="h-9" />
              {ruleFilter && (
                <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setRuleFilter('')}><X className="h-3 w-3" /></Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">筛选目标</label>
            <div className="relative">
              <Input value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)} placeholder="输入目标地址进行筛选..." className="h-9" list="target-list" />
              <datalist id="target-list">{uniqueTargets.map(t => <option key={t} value={t} />)}</datalist>
              {targetFilter && (
                <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setTargetFilter('')}><X className="h-3 w-3" /></Button>
              )}
            </div>
          </div>
          {(ruleFilter || targetFilter) && (
            <div className="self-end">
              <Button variant="outline" size="sm" onClick={() => { setRuleFilter(''); setTargetFilter('') }} className="h-9">清除筛选</Button>
            </div>
          )}
        </div>
      )}

      {viewMode === 'table' ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!mergeByTarget && !ruleFilter && !targetFilter && <TableHead className="w-8"></TableHead>}
                <TableHead className="w-12">启用</TableHead>
                <TableHead>规则</TableHead>
                <TableHead>目标</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!activeFileName ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    请选择或创建一个规则文件
                  </TableCell>
                </TableRow>
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    暂无规则，点击"添加规则"开始配置
                  </TableCell>
                </TableRow>
              ) : filteredRules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    没有匹配的规则，请调整筛选条件
                  </TableCell>
                </TableRow>
              ) : mergeByTarget ? (
                groupedRules.map(group => (
                  <GroupedRuleRow key={group.key} group={group} highlighted={highlightIndex != null && group.indices.includes(highlightIndex)} highlightRef={highlightRowRef}
                    onToggleGroup={createToggleGroupCallback(group.indices, group.enabledState)} onUpdateGroupRules={createUpdateGroupRulesCallback(group.indices)}
                    onUpdateGroupTarget={createUpdateGroupTargetCallback(group.indices)} onDeleteGroup={createDeleteGroupCallback(group.indices)} />
                ))
              ) : ruleFilter || targetFilter ? (
                filteredRules.map(({ item, index }) => (
                  <FilteredRuleRow key={index} item={item} highlighted={highlightIndex === index} highlightRef={highlightRowRef}
                    onToggle={createToggleRuleCallback(index)} onUpdateRule={createUpdateRuleCallback(index)}
                    onDelete={createDeleteRuleCallback(index)} onMoveToTop={createMoveToTopCallback(index)} />
                ))
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={rules.map((_, i) => `rule-${i}`)} strategy={verticalListSortingStrategy}>
                    {rules.map((item, index) => (
                      <SortableRuleRow key={`rule-${index}`} id={`rule-${index}`} item={item} highlighted={highlightIndex === index} highlightRef={highlightRowRef}
                        onToggle={createToggleRuleCallback(index)} onUpdateRule={createUpdateRuleCallback(index)}
                        onDelete={createDeleteRuleCallback(index)} onMoveToTop={createMoveToTopCallback(index)} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-4">
          {!activeFileName ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              请选择或创建一个规则文件后查看图表
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              暂无规则，点击“添加规则”后这里会自动生成路由流向图
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              没有匹配的规则，请调整筛选条件后再查看图表
            </div>
          ) : (
            <RouteCanvas graphData={graphData} />
          )}
        </div>
      )}

      {(ruleFilter || targetFilter) && filteredRules.length > 0 && (
        <div className="text-sm text-muted-foreground">显示 {filteredRules.length} / {rules.length} 条规则</div>
      )}
    </div>
  )
}

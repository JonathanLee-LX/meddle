import { useEffect, useCallback, useMemo, useRef, useState, memo, useTransition, useDeferredValue } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ArrowUpToLine,
  ClipboardPaste,
  FileCode2,
  Filter,
  FolderOpen,
  GitBranch,
  GripVertical,
  Plus,
  Save,
  Table2,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from 'lucide-react'
import type { RuleItem, RuleFile } from '@/types'
import { Badge } from '@/components/ui/badge'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildRuleGraph } from '@/utils/rule-graph'
import { RouteCanvas } from '@/components/route-canvas'
import { supportsOpenFilePicker } from '@/types/file-system-access'
import { FEATURE_FLAGS } from '@/lib/feature-flags'
import { getEprcTextDiagnostics, normalizeImportedRuleText, parseEprcRules, rulesToEprc } from '@/utils/eprc-parser'

interface RuleConfigProps {
  rules: RuleItem[]
  setRules: React.Dispatch<React.SetStateAction<RuleItem[]>>
  ruleFiles: RuleFile[]
  activeFileName: string | null
  fetchRuleFiles: () => Promise<RuleFile[]>
  fetchFileContent: (name: string) => Promise<void>
  fetchRuleFileRawContent: (name: string) => Promise<string>
  saveRuleFileRawContent: (name: string, content: string) => Promise<boolean>
  saveFileContent: (name: string, items: RuleItem[]) => Promise<boolean>
  createRuleFile: (name: string, content?: string) => Promise<{ success: boolean; error?: string }>
  toggleRuleFile: (name: string, enabled: boolean) => Promise<boolean>
  deleteRuleFile: (name: string) => Promise<boolean>
}

interface RouteRuleHighlightEventDetail {
  pattern?: string
  target?: string
}

interface SortableRuleRowProps {
  id: string
  item: RuleItem
  highlighted: boolean
  highlightRef: React.RefObject<HTMLTableRowElement | null>
  onToggle: () => void
  onUpdateRule: (field: 'rule' | 'target' | 'exclusions', value: string | string[]) => void
  onDelete: () => void
  onMoveToTop: () => void
}

interface ExclusionsInputProps {
  exclusions: string[]
  onCommit: (value: string[]) => void
}

function parseExclusionsInput(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

function getAvailableRuleFileName(files: RuleFile[], baseName: string): string {
  const existingNames = new Set(files.map((file) => file.name))
  if (!existingNames.has(baseName)) return baseName

  let index = 2
  while (existingNames.has(`${baseName}-${index}`)) {
    index += 1
  }
  return `${baseName}-${index}`
}

const ExclusionsInput = memo(function ExclusionsInput({ exclusions, onCommit }: ExclusionsInputProps) {
  const [draft, setDraft] = useState(exclusions.join(' '))

  const commitDraft = useCallback(() => {
    onCommit(parseExclusionsInput(draft))
  }, [draft, onCommit])

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft()
        }
      }}
      placeholder="!/api !/ws"
      className="h-8"
    />
  )
})

const SortableRuleRow = memo(
  function SortableRuleRow({ id, item, highlighted, highlightRef, onToggle, onUpdateRule, onDelete, onMoveToTop }: SortableRuleRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    }

    const handleToggle = useCallback(() => onToggle(), [onToggle])
    const handleUpdateRule = useCallback(
      (field: 'rule' | 'target') => (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdateRule(field, e.target.value)
      },
      [onUpdateRule],
    )
    const handleCommitExclusions = useCallback(
      (value: string[]) => {
        onUpdateRule('exclusions', value)
      },
      [onUpdateRule],
    )
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
          <ExclusionsInput key={JSON.stringify(item.exclusions || [])} exclusions={item.exclusions || []} onCommit={handleCommitExclusions} />
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
  },
  (prevProps, nextProps) => {
    return prevProps.item === nextProps.item && prevProps.highlighted === nextProps.highlighted && prevProps.id === nextProps.id
  },
)

interface FilteredRuleRowProps {
  item: RuleItem
  highlighted: boolean
  highlightRef: React.RefObject<HTMLTableRowElement | null>
  onToggle: () => void
  onUpdateRule: (field: 'rule' | 'target' | 'exclusions', value: string | string[]) => void
  onDelete: () => void
  onMoveToTop: () => void
}

const FilteredRuleRow = memo(
  function FilteredRuleRow({ item, highlighted, highlightRef, onToggle, onUpdateRule, onDelete, onMoveToTop }: FilteredRuleRowProps) {
    const handleToggle = useCallback(() => onToggle(), [onToggle])
    const handleUpdateRule = useCallback(
      (field: 'rule' | 'target') => (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdateRule(field, e.target.value)
      },
      [onUpdateRule],
    )
    const handleCommitExclusions = useCallback(
      (value: string[]) => {
        onUpdateRule('exclusions', value)
      },
      [onUpdateRule],
    )
    const handleDelete = useCallback(() => onDelete(), [onDelete])
    const handleMoveToTop = useCallback(() => onMoveToTop(), [onMoveToTop])

    return (
      <TableRow ref={highlighted ? highlightRef : undefined} className={highlighted ? 'bg-amber-100/60 dark:bg-amber-500/20 transition-colors' : undefined}>
        <TableCell>
          <Checkbox checked={item.enabled} onCheckedChange={handleToggle} />
        </TableCell>
        <TableCell>
          <Input value={item.rule} onChange={handleUpdateRule('rule')} placeholder="example.com" className="h-8" />
        </TableCell>
        <TableCell>
          <ExclusionsInput key={JSON.stringify(item.exclusions || [])} exclusions={item.exclusions || []} onCommit={handleCommitExclusions} />
        </TableCell>
        <TableCell>
          <Input value={item.target} onChange={handleUpdateRule('target')} placeholder="127.0.0.1:3000" className="h-8" />
        </TableCell>
        <TableCell>
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
  },
  (prevProps, nextProps) => prevProps.item === nextProps.item && prevProps.highlighted === nextProps.highlighted,
)

export function RuleConfig(props: RuleConfigProps) {
  const {
    rules,
    setRules,
    ruleFiles,
    activeFileName,
    fetchRuleFiles,
    fetchFileContent,
    fetchRuleFileRawContent,
    saveRuleFileRawContent,
    saveFileContent,
    createRuleFile,
    toggleRuleFile,
    deleteRuleFile,
  } = props

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [viewMode, setViewMode] = useState<'table' | 'text' | 'graph'>('table')
  const [textDraft, setTextDraft] = useState('')
  const [loadedTextFileName, setLoadedTextFileName] = useState<string | null>(null)
  const textDraftRef = useRef('')
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  // 创建规则文件
  const [isCreating, setIsCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('默认规则')
  const [createError, setCreateError] = useState<string | null>(null)

  // 从文件加载
  const [isImporting, setIsImporting] = useState(false)
  const [isTextImporting, setIsTextImporting] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState<string | null>(null)
  const [textImportDraft, setTextImportDraft] = useState('')
  const importFileRef = useRef<HTMLInputElement>(null)

  // 筛选
  const [showFilters, setShowFilters] = useState(false)
  const [ruleFilter, setRuleFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const deferredRuleFilter = useDeferredValue(ruleFilter)
  const deferredTargetFilter = useDeferredValue(targetFilter)
  const [isPending, startTransition] = useTransition()

  const resetCreateDialog = useCallback(() => {
    setIsCreating(false)
    setIsImporting(false)
    setIsTextImporting(false)
    setImportContent(null)
    setImportName('')
    setTextImportDraft('')
    setCreateError(null)
  }, [])

  // 初始化：加载文件列表并选中第一个
  useEffect(() => {
    fetchRuleFiles().then((files) => {
      if (files.length > 0 && !activeFileName) {
        const enabledFile = files.find((f) => f.enabled) || files[0]
        fetchFileContent(enabledFile.name)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换文件
  const handleSelectFile = useCallback(
    async (name: string) => {
      await fetchFileContent(name)
    },
    [fetchFileContent],
  )

  useEffect(() => {
    let cancelled = false
    if (!activeFileName) {
      textDraftRef.current = ''
      return
    }

    fetchRuleFileRawContent(activeFileName)
      .then((content) => {
        if (!cancelled) {
          textDraftRef.current = content
          setTextDraft(content)
        }
      })
      .catch(() => {
        if (!cancelled) {
          const content = rulesToEprc(rules)
          textDraftRef.current = content
          setTextDraft(content)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedTextFileName(activeFileName)
      })

    return () => {
      cancelled = true
    }
  }, [activeFileName, fetchRuleFileRawContent]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeFileName || viewMode === 'text') return

    const serializedRules = rulesToEprc(rules)
    const serializedDraftRules = rulesToEprc(parseEprcRules(textDraftRef.current))
    if (serializedDraftRules === serializedRules) return

    textDraftRef.current = serializedRules
    setTextDraft(serializedRules)
  }, [activeFileName, rules, viewMode])

  // 创建新规则文件
  const handleCreate = useCallback(async () => {
    if (!newFileName.trim()) return
    setCreateError(null)
    const content = isTextImporting ? normalizeImportedRuleText(textImportDraft) : importContent || ''
    if (isTextImporting && !content.trim()) {
      setCreateError('请输入规则文本')
      return
    }
    const result = await createRuleFile(newFileName.trim(), content)
    if (result.success) {
      resetCreateDialog()
      setNewFileName('默认规则')
      await fetchFileContent(newFileName.trim())
    } else {
      setCreateError(result.error || '创建失败')
    }
  }, [createRuleFile, newFileName, isTextImporting, textImportDraft, importContent, resetCreateDialog, fetchFileContent])

  // 从文件导入 → 创建新规则文件
  const handleImportFile = useCallback(async () => {
    if (supportsOpenFilePicker(window)) {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [
            {
              description: '规则文件',
              accept: { 'text/plain': ['.txt', '.rules'] },
            },
          ],
          multiple: false,
        })
        const file = await fileHandle.getFile()
        const content = await file.text()
        const baseName = file.name.replace(/\.[^.]+$/, '')
        setImportContent(content)
        setImportName(baseName)
        setNewFileName(baseName)
        setIsImporting(true)
        setIsTextImporting(false)
        setTextImportDraft('')
        setIsCreating(true)
        return
      } catch {
        /* cancelled */
      }
    }
    importFileRef.current?.click()
  }, [])

  const handleImportInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      file.text().then((content) => {
        const baseName = file.name.replace(/\.[^.]+$/, '')
        setImportContent(content)
        setImportName(baseName)
        setNewFileName(baseName)
        setIsImporting(true)
        setIsTextImporting(false)
        setTextImportDraft('')
        setIsCreating(true)
      })
    }
    e.target.value = ''
  }, [])

  const handleImportText = useCallback(() => {
    const name = getAvailableRuleFileName(ruleFiles, '文本导入')
    setNewFileName(name)
    setImportContent(null)
    setImportName('文本导入')
    setTextImportDraft('')
    setIsImporting(true)
    setIsTextImporting(true)
    setIsCreating(true)
    setCreateError(null)
  }, [ruleFiles])

  // 保存当前文件
  const handleSave = useCallback(async () => {
    if (!activeFileName) return
    setSaving(true)
    setSaveStatus('idle')
    const ok = viewMode === 'text' ? await saveRuleFileRawContent(activeFileName, textDraft) : await saveFileContent(activeFileName, rules)
    setSaving(false)
    setSaveStatus(ok ? 'success' : 'error')
    setTimeout(() => setSaveStatus('idle'), 2000)
    if (ok) fetchRuleFiles()
  }, [activeFileName, fetchRuleFiles, rules, saveFileContent, saveRuleFileRawContent, textDraft, viewMode])

  // 删除规则文件
  const handleDelete = useCallback(
    async (name: string) => {
      if (!confirm(`确定要删除规则文件「${name}」吗？`)) return
      await deleteRuleFile(name)
    },
    [deleteRuleFile],
  )

  // 规则编辑操作
  const toggleRule = useCallback(
    (index: number) => {
      startTransition(() => setRules((prev) => prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))))
    },
    [setRules],
  )

  const updateRule = useCallback(
    (index: number, field: 'rule' | 'target' | 'exclusions', value: string | string[]) => {
      setRules((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
    },
    [setRules],
  )

  const deleteRule = useCallback(
    (index: number) => {
      startTransition(() => setRules((prev) => prev.filter((_, i) => i !== index)))
    },
    [setRules],
  )

  const addRule = useCallback(() => {
    startTransition(() => setRules((prev) => [{ enabled: true, rule: '', target: '', exclusions: [] }, ...prev]))
    setHighlightIndex(0)
  }, [setRules])

  const moveToTop = useCallback(
    (index: number) => {
      startTransition(() =>
        setRules((prev) => {
          const n = [...prev]
          const [item] = n.splice(index, 1)
          n.unshift(item)
          return n
        }),
      )
      setHighlightIndex(0)
    },
    [setRules],
  )

  const handleTextChange = useCallback(
    (value: string) => {
      textDraftRef.current = value
      setTextDraft(value)
      setRules(parseEprcRules(value))
    },
    [setRules],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        setRules((prev) => {
          const oldIndex = prev.findIndex((_, i) => `rule-${i}` === active.id)
          const newIndex = prev.findIndex((_, i) => `rule-${i}` === over.id)
          return arrayMove(prev, oldIndex, newIndex)
        })
      }
    },
    [setRules],
  )

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    if (highlightIndex == null) return
    const raf = requestAnimationFrame(() => {
      highlightRowRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    })
    const timer = setTimeout(() => setHighlightIndex(null), 1600)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [rules, highlightIndex])

  useEffect(() => {
    const handleHighlightRule = (event: Event) => {
      const detail = (event as CustomEvent<RouteRuleHighlightEventDetail>).detail || {}
      const pattern = detail.pattern?.trim()
      const target = detail.target?.trim()
      if (!pattern || target == null) return

      const index = rules.findIndex((item) => item.rule.trim() === pattern && item.target.trim() === target)
      if (index < 0) return

      setViewMode('table')
      setRuleFilter('')
      setTargetFilter('')
      setHighlightIndex(index)
    }

    window.addEventListener('route-rule:highlight', handleHighlightRule)
    return () => window.removeEventListener('route-rule:highlight', handleHighlightRule)
  }, [rules])

  const filteredRules = useMemo(() => {
    if (!deferredRuleFilter && !deferredTargetFilter) return rules.map((item, index) => ({ item, index }))
    const lr = deferredRuleFilter.toLowerCase()
    const lt = deferredTargetFilter.toLowerCase()
    return rules
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        return (!deferredRuleFilter || item.rule.toLowerCase().includes(lr)) && (!deferredTargetFilter || item.target.toLowerCase().includes(lt))
      })
  }, [rules, deferredRuleFilter, deferredTargetFilter])

  const uniqueTargets = useMemo(() => {
    const targets = new Set<string>()
    rules.forEach((item) => {
      if (item.target.trim()) targets.add(item.target.trim())
    })
    return Array.from(targets).sort()
  }, [rules])

  const graphData = useMemo(() => {
    return buildRuleGraph(
      rules,
      filteredRules.map(({ index }) => index),
    )
  }, [rules, filteredRules])

  const displayedTextDraft = activeFileName ? textDraft : ''
  const textLoading = Boolean(activeFileName && loadedTextFileName !== activeFileName)
  const textDiagnostics = useMemo(() => getEprcTextDiagnostics(displayedTextDraft), [displayedTextDraft])

  const createToggleRuleCallback = useCallback((index: number) => () => toggleRule(index), [toggleRule])
  const createUpdateRuleCallback = useCallback(
    (index: number) => (field: 'rule' | 'target' | 'exclusions', value: string | string[]) => updateRule(index, field, value),
    [updateRule],
  )
  const createDeleteRuleCallback = useCallback((index: number) => () => deleteRule(index), [deleteRule])
  const createMoveToTopCallback = useCallback((index: number) => () => moveToTop(index), [moveToTop])

  return (
    <div className="flex flex-col gap-4">
      {/* 规则文件 Tab 切换 */}
      <div className="min-w-0 overflow-x-auto">
        <Tabs
          className="min-w-max"
          value={activeFileName || ''}
          onValueChange={(val) => {
            if (val === '__create__') {
              setIsCreating(true)
              setIsImporting(false)
              setIsTextImporting(false)
              setImportContent(null)
              setImportName('')
              setTextImportDraft('')
              setCreateError(null)
            } else {
              handleSelectFile(val)
            }
          }}
        >
          <TabsList className="h-auto justify-start gap-1">
            {ruleFiles.map((rf) => (
              <TabsTrigger key={rf.name} value={rf.name} className="group relative flex-none gap-1.5">
                <button
                  className="shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleRuleFile(rf.name, !rf.enabled)
                  }}
                  title={rf.enabled ? '点击禁用路由' : '点击启用路由'}
                >
                  {rf.enabled ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
                </button>
                <span>{rf.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {rf.ruleCount}
                </Badge>
                {ruleFiles.length > 1 && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(rf.name)
                    }}
                    title="删除规则文件"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="__create__" className="flex-none">
              <Plus />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 创建/导入规则文件对话框 */}
      {isCreating && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">{isTextImporting ? '从文本导入为新规则' : isImporting ? '从文件导入为新规则' : '创建新规则文件'}</p>
          {isImporting && importName && !isTextImporting && <p className="text-xs text-muted-foreground">导入自: {importName}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newFileName}
              onChange={(e) => {
                setNewFileName(e.target.value)
                setCreateError(null)
              }}
              placeholder="规则文件名称"
              className="h-8 w-48"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') resetCreateDialog()
              }}
            />
            <Button size="sm" onClick={handleCreate}>
              创建
            </Button>
            <Button size="sm" variant="ghost" onClick={resetCreateDialog}>
              取消
            </Button>
          </div>
          {isTextImporting && (
            <Textarea
              value={textImportDraft}
              onChange={(e) => {
                setTextImportDraft(e.target.value)
                setCreateError(null)
              }}
              placeholder={'127.0.0.1 example.com api.example.com\n::1 local.example.test'}
              className="min-h-[160px] resize-y font-mono text-sm"
            />
          )}
          {createError && <p className="text-xs text-destructive">{createError}</p>}
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          {isPending && <div className="text-xs text-muted-foreground">(更新中...)</div>}
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => {
              if (value) setViewMode(value as 'table' | 'text' | 'graph')
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="规则视图"
          >
            <ToggleGroupItem value="table">
              <Table2 />
              表格
            </ToggleGroupItem>
            <ToggleGroupItem value="text">
              <FileCode2 />
              文本
            </ToggleGroupItem>
            {FEATURE_FLAGS.ruleGraphView && (
              <ToggleGroupItem value="graph">
                <GitBranch />
                图表
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          {viewMode !== 'text' && (
            <Button variant={showFilters ? 'selected' : 'outline'} size="sm" onClick={() => setShowFilters((v) => !v)} title="显示/隐藏筛选器">
              <Filter data-icon="inline-start" />
              筛选
            </Button>
          )}
          {viewMode === 'table' && (
            <>
              <Button variant="outline" size="sm" onClick={addRule} disabled={!activeFileName}>
                <Plus data-icon="inline-start" />
                添加规则
              </Button>
              <input ref={importFileRef} type="file" accept=".txt,.rules" className="hidden" onChange={handleImportInputChange} />
              <Button variant="outline" size="sm" onClick={handleImportFile}>
                <FolderOpen data-icon="inline-start" />
                从文件加载
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportText}>
                <ClipboardPaste data-icon="inline-start" />
                文本导入
              </Button>
            </>
          )}
          {activeFileName && (
            <>
              <Button size="sm" onClick={handleSave} disabled={saving || textLoading}>
                <Save data-icon="inline-start" />
                {saving ? '保存中...' : '保存'}
              </Button>
              {saveStatus === 'success' && <Badge variant="secondary">已保存</Badge>}
              {saveStatus === 'error' && <Badge variant="destructive">保存失败</Badge>}
            </>
          )}
        </div>
      </div>

      {/* 筛选器 */}
      {showFilters && viewMode !== 'text' && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">筛选规则</label>
            <div className="relative">
              <Input value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} placeholder="输入规则名称进行筛选..." className="h-9" />
              {ruleFilter && (
                <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setRuleFilter('')}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">筛选目标</label>
            <div className="relative">
              <Input
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                placeholder="输入目标地址进行筛选..."
                className="h-9"
                list="target-list"
              />
              <datalist id="target-list">
                {uniqueTargets.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {targetFilter && (
                <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setTargetFilter('')}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          {(ruleFilter || targetFilter) && (
            <div className="self-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRuleFilter('')
                  setTargetFilter('')
                }}
                className="h-9"
              >
                清除筛选
              </Button>
            </div>
          )}
        </div>
      )}

      {viewMode === 'text' ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="规则文本"
            value={displayedTextDraft}
            onChange={(event) => handleTextChange(event.target.value)}
            disabled={!activeFileName || textLoading}
            placeholder={activeFileName ? 'example.com !/api localhost:3000' : '请先选择或创建一个规则文件'}
            className="min-h-[480px] resize-y font-mono text-sm leading-6"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{textLoading ? '正在加载规则文本...' : `已解析 ${rules.length} 条规则`}</span>
            {textDiagnostics.length > 0 && (
              <Badge variant="outline">
                {textDiagnostics.length} 行未识别：
                {textDiagnostics
                  .slice(0, 3)
                  .map((item) => item.line)
                  .join('、')}
                {textDiagnostics.length > 3 ? '…' : ''}
              </Badge>
            )}
          </div>
        </div>
      ) : viewMode === 'table' || !FEATURE_FLAGS.ruleGraphView ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!ruleFilter && !targetFilter && <TableHead className="w-8"></TableHead>}
                <TableHead className="w-12">启用</TableHead>
                <TableHead>规则</TableHead>
                <TableHead>排除</TableHead>
                <TableHead>目标</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!activeFileName ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    请选择或创建一个规则文件
                  </TableCell>
                </TableRow>
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    暂无规则，点击"添加规则"开始配置
                  </TableCell>
                </TableRow>
              ) : filteredRules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    没有匹配的规则，请调整筛选条件
                  </TableCell>
                </TableRow>
              ) : ruleFilter || targetFilter ? (
                filteredRules.map(({ item, index }) => (
                  <FilteredRuleRow
                    key={index}
                    item={item}
                    highlighted={highlightIndex === index}
                    highlightRef={highlightRowRef}
                    onToggle={createToggleRuleCallback(index)}
                    onUpdateRule={createUpdateRuleCallback(index)}
                    onDelete={createDeleteRuleCallback(index)}
                    onMoveToTop={createMoveToTopCallback(index)}
                  />
                ))
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={rules.map((_, i) => `rule-${i}`)} strategy={verticalListSortingStrategy}>
                    {rules.map((item, index) => (
                      <SortableRuleRow
                        key={`rule-${index}`}
                        id={`rule-${index}`}
                        item={item}
                        highlighted={highlightIndex === index}
                        highlightRef={highlightRowRef}
                        onToggle={createToggleRuleCallback(index)}
                        onUpdateRule={createUpdateRuleCallback(index)}
                        onDelete={createDeleteRuleCallback(index)}
                        onMoveToTop={createMoveToTopCallback(index)}
                      />
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
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">请选择或创建一个规则文件后查看图表</div>
          ) : rules.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">暂无规则，点击“添加规则”后这里会自动生成路由流向图</div>
          ) : filteredRules.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">没有匹配的规则，请调整筛选条件后再查看图表</div>
          ) : (
            <RouteCanvas graphData={graphData} />
          )}
        </div>
      )}

      {(ruleFilter || targetFilter) && filteredRules.length > 0 && (
        <div className="text-sm text-muted-foreground">
          显示 {filteredRules.length} / {rules.length} 条规则
        </div>
      )}
    </div>
  )
}

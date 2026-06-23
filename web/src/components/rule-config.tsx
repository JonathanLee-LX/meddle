import { useEffect, useCallback, useMemo, useRef, useState, memo, useTransition, useDeferredValue } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ArrowUpToLine,
  Check,
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildRuleGraph } from '@/utils/rule-graph'
import { RouteCanvas } from '@/components/route-canvas'
import { supportsOpenFilePicker } from '@/types/file-system-access'
import { FEATURE_FLAGS } from '@/lib/feature-flags'
import { getEprcTextDiagnostics, normalizeImportedRuleText, parseEprcRules, rulesToEprc } from '@/utils/eprc-parser'
import { EprcTextarea } from '@/components/eprc-textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  renameRuleFile: (name: string, newName: string) => Promise<{ success: boolean; name?: string; error?: string }>
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

const RULE_ROW_HIGHLIGHT_CLASS = 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)] transition-[background-color,box-shadow]'

function sameRowOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

export function getRuleRowOrder(rowIds: string[], activeId: string | number, overId: string | number | null | undefined): string[] {
  if (overId == null) return rowIds

  const activeKey = String(activeId)
  const overKey = String(overId)
  if (activeKey === overKey) return rowIds

  const oldIndex = rowIds.indexOf(activeKey)
  const newIndex = rowIds.indexOf(overKey)
  if (oldIndex < 0 || newIndex < 0) return rowIds

  return arrayMove(rowIds, oldIndex, newIndex)
}

export function reorderItemsByRowIds<T>(items: T[], rowIds: string[], orderedRowIds: string[]): T[] {
  if (items.length !== rowIds.length || rowIds.length !== orderedRowIds.length) return items

  const itemById = new Map(rowIds.map((id, index) => [id, items[index]]))
  if (orderedRowIds.some((id) => !itemById.has(id))) return items

  return orderedRowIds.map((id) => itemById.get(id) as T)
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

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.85 : 1,
      position: 'relative',
      zIndex: isDragging ? 1 : undefined,
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
    const setRowRef = useCallback(
      (node: HTMLTableRowElement | null) => {
        setNodeRef(node)
        if (highlighted && highlightRef) {
          highlightRef.current = node
        }
      },
      [highlightRef, highlighted, setNodeRef],
    )

    return (
      <TableRow
        ref={setRowRef}
        style={style}
        className={highlighted ? RULE_ROW_HIGHLIGHT_CLASS : undefined}
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
      <TableRow ref={highlighted ? highlightRef : undefined} className={highlighted ? RULE_ROW_HIGHLIGHT_CLASS : undefined}>
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

function RuleTableColGroup({ showDragColumn }: { showDragColumn: boolean }) {
  if (showDragColumn) {
    return (
      <colgroup>
        <col style={{ width: '2rem' }} />
        <col style={{ width: '3rem' }} />
        <col />
        <col />
        <col />
        <col style={{ width: '6rem' }} />
      </colgroup>
    )
  }

  return (
    <colgroup>
      <col style={{ width: '3rem' }} />
      <col />
      <col />
      <col />
      <col style={{ width: '6rem' }} />
    </colgroup>
  )
}

function RuleTableHeaderCells({ showDragColumn }: { showDragColumn: boolean }) {
  return (
    <TableRow>
      {showDragColumn && <TableHead className="w-8" />}
      <TableHead className="w-12">启用</TableHead>
      <TableHead>规则</TableHead>
      <TableHead>排除</TableHead>
      <TableHead>目标</TableHead>
      <TableHead className="w-24">操作</TableHead>
    </TableRow>
  )
}

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
    renameRuleFile,
    deleteRuleFile,
  } = props

  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'text' | 'graph'>('table')
  const [textDraft, setTextDraft] = useState('')
  const [loadedTextFileName, setLoadedTextFileName] = useState<string | null>(null)
  const textDraftRef = useRef('')
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)
  const nextRuleRowIdRef = useRef(0)
  const createRuleRowId = useCallback(() => `rule-${nextRuleRowIdRef.current++}`, [])
  const [ruleRowIds, setRuleRowIds] = useState<string[]>(() => rules.map(() => createRuleRowId()))

  // 创建规则文件
  const [isCreating, setIsCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('默认规则')
  const [createError, setCreateError] = useState<string | null>(null)
  const [renamingFileName, setRenamingFileName] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameInFlightRef = useRef(false)

  // 从文件加载
  const [isImporting, setIsImporting] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // 文本导入弹窗（独立于内联创建流程）
  const [textImportOpen, setTextImportOpen] = useState(false)
  const [textImportName, setTextImportName] = useState('')
  const [textImportDraft, setTextImportDraft] = useState('')
  const [textImportError, setTextImportError] = useState<string | null>(null)
  const [textImportCreating, setTextImportCreating] = useState(false)

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
    setImportContent(null)
    setImportName('')
    setCreateError(null)
  }, [])

  const beginCreateRuleFile = useCallback(() => {
    setNewFileName(getAvailableRuleFileName(ruleFiles, '默认规则'))
    setIsCreating(true)
    setIsImporting(false)
    setImportContent(null)
    setImportName('')
    setCreateError(null)
  }, [ruleFiles])

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

  useEffect(() => {
    setRuleRowIds((prev) => {
      if (prev.length === rules.length) return prev
      if (prev.length > rules.length) return prev.slice(0, rules.length)
      return [
        ...prev,
        ...Array.from({ length: rules.length - prev.length }, () => createRuleRowId()),
      ]
    })
  }, [createRuleRowId, rules.length])

  // 创建新规则文件（文件导入 / Plus 创建走此内联流程）
  const handleCreate = useCallback(async () => {
    if (!newFileName.trim()) return
    setCreateError(null)
    const content = importContent || ''
    const result = await createRuleFile(newFileName.trim(), content)
    if (result.success) {
      resetCreateDialog()
      setNewFileName('默认规则')
      await fetchFileContent(newFileName.trim())
    } else {
      setCreateError(result.error || '创建失败')
    }
  }, [createRuleFile, newFileName, importContent, resetCreateDialog, fetchFileContent])

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
        setIsCreating(true)
      })
    }
    e.target.value = ''
  }, [])

  // 文本导入：打开弹窗
  const handleImportText = useCallback(() => {
    setTextImportName(getAvailableRuleFileName(ruleFiles, '文本导入'))
    setTextImportDraft('')
    setTextImportError(null)
    setTextImportCreating(false)
    setTextImportOpen(true)
  }, [ruleFiles])

  // 文本导入弹窗：解析预览
  const textImportParsedRules = useMemo(
    () => parseEprcRules(normalizeImportedRuleText(textImportDraft)),
    [textImportDraft],
  )
  const textImportDiagnostics = useMemo(
    () => getEprcTextDiagnostics(normalizeImportedRuleText(textImportDraft)),
    [textImportDraft],
  )

  // 文本导入弹窗：确认创建
  const handleConfirmTextImport = useCallback(async () => {
    const name = textImportName.trim()
    if (!name) {
      setTextImportError('规则文件名称不能为空')
      return
    }
    const content = normalizeImportedRuleText(textImportDraft)
    if (!content.trim()) {
      setTextImportError('请输入规则文本')
      return
    }
    // 存在未识别行时阻断创建（与文本编辑保存校验一致）
    if (getEprcTextDiagnostics(content).length > 0) {
      setTextImportError('规则文本存在无法识别的行，请先修正')
      return
    }
    setTextImportCreating(true)
    const result = await createRuleFile(name, content)
    setTextImportCreating(false)
    if (result.success) {
      setTextImportOpen(false)
      await fetchFileContent(name)
    } else {
      setTextImportError(result.error || '创建失败')
    }
  }, [createRuleFile, fetchFileContent, textImportDraft, textImportName])

  // 保存当前文件
  const handleSave = useCallback(async () => {
    if (!activeFileName) return
    // 文本模式下若有未识别行，阻止保存（按钮已禁用，此处为防御性兜底）
    if (viewMode === 'text' && getEprcTextDiagnostics(textDraft).length > 0) return
    setSaving(true)
    const ok = viewMode === 'text' ? await saveRuleFileRawContent(activeFileName, textDraft) : await saveFileContent(activeFileName, rules)
    setSaving(false)
    if (ok) {
      fetchRuleFiles()
      toast.success('规则保存成功')
    } else {
      toast.error('规则保存失败')
    }
  }, [activeFileName, fetchRuleFiles, rules, saveFileContent, saveRuleFileRawContent, textDraft, viewMode])

  // 删除规则文件
  const handleDelete = useCallback(
    async (name: string) => {
      if (!confirm(`确定要删除规则文件「${name}」吗？`)) return
      await deleteRuleFile(name)
    },
    [deleteRuleFile],
  )

  const beginRename = useCallback((name: string) => {
    setRenamingFileName(name)
    setRenameDraft(name)
    setRenameError(null)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingFileName(null)
    setRenameDraft('')
    setRenameError(null)
  }, [])

  const commitRename = useCallback(async () => {
    if (!renamingFileName || renameInFlightRef.current) return
    const nextName = renameDraft.trim()
    if (!nextName) {
      setRenameError('规则文件名称不能为空')
      return
    }
    if (nextName === renamingFileName) {
      cancelRename()
      return
    }

    renameInFlightRef.current = true
    try {
      const result = await renameRuleFile(renamingFileName, nextName)
      if (result.success) {
        setRenamingFileName(null)
        setRenameDraft('')
        setRenameError(null)
        await fetchFileContent(result.name || nextName)
      } else {
        setRenameError(result.error || '重命名失败')
      }
    } finally {
      renameInFlightRef.current = false
    }
  }, [cancelRename, fetchFileContent, renameDraft, renameRuleFile, renamingFileName])

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
      setRuleRowIds((prev) => prev.filter((_, i) => i !== index))
      startTransition(() => setRules((prev) => prev.filter((_, i) => i !== index)))
    },
    [setRules],
  )

  const addRule = useCallback(() => {
    setRuleRowIds((prev) => [createRuleRowId(), ...prev])
    startTransition(() => setRules((prev) => [{ enabled: true, rule: '', target: '', exclusions: [] }, ...prev]))
    setHighlightIndex(0)
  }, [createRuleRowId, setRules])

  const moveToTop = useCallback(
    (index: number) => {
      setRuleRowIds((prev) => arrayMove(prev, index, 0))
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
      const nextRowIds = over ? getRuleRowOrder(ruleRowIds, active.id, over.id) : ruleRowIds

      if (!sameRowOrder(nextRowIds, ruleRowIds)) {
        setRuleRowIds(nextRowIds)
        setRules((prev) => {
          return reorderItemsByRowIds(prev, ruleRowIds, nextRowIds)
        })
      }
    },
    [ruleRowIds, setRules],
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

  const sortableRuleRows = useMemo(() => {
    const rows = rules
      .map((item, index) => ({ item, index, id: ruleRowIds[index] }))
      .filter((row): row is { item: RuleItem; index: number; id: string } => Boolean(row.id))
    const rowById = new Map(rows.map((row) => [row.id, row]))

    return ruleRowIds
      .map((id) => rowById.get(id))
      .filter((row): row is { item: RuleItem; index: number; id: string } => Boolean(row))
  }, [ruleRowIds, rules])

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
  const textHasErrors = viewMode === 'text' && textDiagnostics.length > 0
  const showDragColumn = !ruleFilter && !targetFilter

  // Ctrl/Cmd+S 快捷保存（与保存按钮的禁用条件保持一致）
  const canSave = Boolean(activeFileName) && !saving && !textLoading && !textHasErrors
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')
      if (!isSaveShortcut) return
      // 文本导入弹窗打开时不拦截，避免影响弹窗内输入
      if (textImportOpen) return
      event.preventDefault()
      if (canSave) void handleSave()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canSave, handleSave, textImportOpen])

  const createToggleRuleCallback = useCallback((index: number) => () => toggleRule(index), [toggleRule])
  const createUpdateRuleCallback = useCallback(
    (index: number) => (field: 'rule' | 'target' | 'exclusions', value: string | string[]) => updateRule(index, field, value),
    [updateRule],
  )
  const createDeleteRuleCallback = useCallback((index: number) => () => deleteRule(index), [deleteRule])
  const createMoveToTopCallback = useCallback((index: number) => () => moveToTop(index), [moveToTop])

  return (
    <div className="app-page-stack">
      <Card
        data-testid="rule-panel-card"
        className="min-h-0 flex-1 gap-0 overflow-hidden py-0 shadow-none"
      >
        <div
          data-slot="rule-config-sticky-controls"
          className="shrink-0 rounded-t-xl bg-card"
        >
          <CardHeader className="block border-b bg-muted/30 p-0 [.border-b]:pb-0">
            <CardTitle className="sr-only">规则内容</CardTitle>
            <div className="flex min-w-0 items-center px-3 py-2">
              <div data-slot="rule-file-tabs-scroll" className="min-w-0 flex-1 overflow-x-auto">
                <Tabs
                  className="min-w-max"
                  value={activeFileName || ''}
                  onValueChange={handleSelectFile}
                >
                  <TabsList className="h-auto min-w-max justify-start gap-1 rounded-none bg-transparent p-0">
                    {ruleFiles.map((rf) => (
                      <TabsTrigger key={rf.name} value={rf.name} className="group relative flex-none gap-1.5">
                        <span
                          role="button"
                          tabIndex={0}
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleRuleFile(rf.name, !rf.enabled)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              toggleRuleFile(rf.name, !rf.enabled)
                            }
                          }}
                          title={rf.enabled ? '点击禁用路由' : '点击启用路由'}
                        >
                          {rf.enabled ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
                        </span>
                        {renamingFileName === rf.name ? (
                          <input
                            value={renameDraft}
                            onChange={(event) => {
                              setRenameDraft(event.target.value)
                              setRenameError(null)
                            }}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={() => void commitRename()}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void commitRename()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                cancelRename()
                              }
                            }}
                            className="h-6 w-28 rounded border bg-background px-1.5 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                            aria-label={`重命名规则文件 ${rf.name}`}
                            autoFocus
                          />
                        ) : (
                          <span
                            onDoubleClick={(event) => {
                              event.stopPropagation()
                              beginRename(rf.name)
                            }}
                            title="双击重命名"
                          >
                            {rf.name}
                          </span>
                        )}
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          {rf.ruleCount}
                        </Badge>
                        {ruleFiles.length > 1 && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(rf.name)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                event.stopPropagation()
                                handleDelete(rf.name)
                              }
                            }}
                            title="删除规则文件"
                          >
                            <X className="size-3" />
                          </span>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <div data-slot="rule-file-actions" className="ml-2 flex shrink-0 items-center border-l pl-2">
                {isCreating ? (
                  <div
                    role="group"
                    aria-label={isImporting ? '从文件导入为新规则' : '创建新规则文件'}
                    className="flex h-8 items-center gap-1 rounded-md border border-primary/30 bg-background px-1 shadow-sm"
                    title={isImporting && importName ? `导入自: ${importName}` : undefined}
                  >
                    <Input
                      value={newFileName}
                      onChange={(event) => {
                        setNewFileName(event.target.value)
                        setCreateError(null)
                      }}
                      placeholder="规则文件名称"
                      className="h-6 w-36 border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0"
                      aria-label="新规则文件名称"
                      autoFocus
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleCreate()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          resetCreateDialog()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void handleCreate()}
                      aria-label="确认创建规则文件"
                      title="创建"
                    >
                      <Check />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={resetCreateDialog} aria-label="取消创建规则文件" title="取消">
                      <X />
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={beginCreateRuleFile} aria-label="创建规则文件" title="创建规则文件">
                    <Plus />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <div className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => {
                  if (value) setViewMode(value as 'table' | 'text' | 'graph')
                }}
                variant="outline"
                size="sm"
                spacing={0}
                className="bg-background"
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
              {isPending && (
                <span className="text-xs text-muted-foreground">更新中...</span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {viewMode !== 'text' && (
                <Button
                  variant={showFilters ? 'selected' : 'outline'}
                  size="sm"
                  onClick={() => setShowFilters((v) => !v)}
                  title="显示/隐藏筛选器"
                >
                  <Filter data-icon="inline-start" />
                  筛选
                </Button>
              )}
              {viewMode === 'table' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addRule}
                    disabled={!activeFileName}
                  >
                    <Plus data-icon="inline-start" />
                    添加规则
                  </Button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".txt,.rules"
                    className="hidden"
                    onChange={handleImportInputChange}
                  />
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
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || textLoading || textHasErrors}
                  title={
                    textHasErrors
                      ? `${textDiagnostics.length} 行内容无法识别，请先修正`
                      : '保存 (Ctrl/Cmd+S)'
                  }
                >
                  {saving ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  保存
                </Button>
              )}
            </div>
          </div>
        </div>

        {(renameError || createError) && (
          <div className="flex shrink-0 flex-col gap-1 border-b px-3 py-2 text-xs text-destructive">
            {renameError && <p>{renameError}</p>}
            {createError && <p>{createError}</p>}
          </div>
        )}


        {showFilters && viewMode !== 'text' && (
          <div className="flex shrink-0 flex-col gap-3 border-b bg-muted/20 p-3 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                筛选规则
              </label>
              <div className="relative">
                <Input
                  value={ruleFilter}
                  onChange={(e) => setRuleFilter(e.target.value)}
                  placeholder="输入规则名称进行筛选..."
                  className="h-9"
                />
                {ruleFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                    onClick={() => setRuleFilter('')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                筛选目标
              </label>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                    onClick={() => setTargetFilter('')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            {(ruleFilter || targetFilter) && (
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
            )}
          </div>
        )}

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {viewMode === 'text' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <EprcTextarea
                ariaLabel="规则文本"
                value={displayedTextDraft}
                onChange={handleTextChange}
                disabled={!activeFileName || textLoading}
                placeholder={
                  activeFileName
                    ? 'example.com !/api localhost:3000'
                    : '请先选择或创建一个规则文件'
                }
              />
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
                <span>
                  {textLoading
                    ? '正在加载规则文本...'
                    : `已解析 ${rules.length} 条规则`}
                </span>
                {textDiagnostics.length > 0 && (
                  <Badge variant="destructive" title="存在无法识别的行，保存已禁用">
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                data-slot="rule-table-header"
                className="z-10 shrink-0 overflow-x-auto bg-card"
              >
                <Table className="table-fixed">
                  <RuleTableColGroup showDragColumn={showDragColumn} />
                  <TableHeader>
                    <RuleTableHeaderCells showDragColumn={showDragColumn} />
                  </TableHeader>
                </Table>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <Table className="table-fixed">
                  <RuleTableColGroup showDragColumn={showDragColumn} />
                  <TableBody>
                  {!activeFileName ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        请选择或创建一个规则文件
                      </TableCell>
                    </TableRow>
                  ) : rules.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        暂无规则，点击"添加规则"开始配置
                      </TableCell>
                    </TableRow>
                  ) : filteredRules.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
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
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={sortableRuleRows.map((row) => row.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {sortableRuleRows.map(({ item, index, id }) => (
                          <SortableRuleRow
                            key={id}
                            id={id}
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
            </ScrollArea>
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 p-4">
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
            </ScrollArea>
          )}
        </CardContent>

        {(ruleFilter || targetFilter) && filteredRules.length > 0 && (
          <CardFooter className="shrink-0 border-t px-4 py-2 text-sm text-muted-foreground [.border-t]:pt-2">
            显示 {filteredRules.length} / {rules.length} 条规则
          </CardFooter>
        )}
      </Card>

      {/* 文本导入弹窗 */}
      <Dialog open={textImportOpen} onOpenChange={setTextImportOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>文本导入</DialogTitle>
            <DialogDescription>
              粘贴或编辑规则文本，支持 hosts 文件格式自动转换。每行一条规则，格式：<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">规则 [排除项] 目标</code>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="text-import-name">
              规则文件名称
            </label>
            <Input
              id="text-import-name"
              value={textImportName}
              onChange={(e) => {
                setTextImportName(e.target.value)
                setTextImportError(null)
              }}
              placeholder="规则文件名称"
              className="font-mono"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="text-import-content">
              规则文本
            </label>
            <div className="min-h-[220px] flex-1 overflow-hidden rounded-md border">
              <EprcTextarea
                ariaLabel="导入规则文本"
                value={textImportDraft}
                onChange={setTextImportDraft}
                placeholder={'127.0.0.1 example.com api.example.com\n::1 local.example.test'}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>已解析 {textImportParsedRules.length} 条规则</span>
              {textImportDiagnostics.length > 0 && (
                <Badge variant="destructive">
                  {textImportDiagnostics.length} 行未识别：
                  {textImportDiagnostics.slice(0, 3).map((item) => item.line).join('、')}
                  {textImportDiagnostics.length > 3 ? '…' : ''}
                </Badge>
              )}
            </div>
          </div>

          {textImportError && (
            <p className="text-xs text-destructive">{textImportError}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTextImportOpen(false)} disabled={textImportCreating}>
              取消
            </Button>
            <Button onClick={handleConfirmTextImport} disabled={textImportCreating}>
              {textImportCreating ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

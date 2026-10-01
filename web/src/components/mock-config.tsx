/**
 * Mock config — full-width list | edit (modules/02-mock).
 * Not traffic B: config-page internal split. Traffic → one-click create lands here with prefill.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, FileText, Code } from 'lucide-react'
import type { MockRule } from '@/types'
import { MockEditorPanel } from '@/components/mock-editor-panel'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { MOCK_OPEN_CREATE_EVENT, type MockOpenCreateDetail } from '@/lib/mock-config-events'

export { MOCK_OPEN_CREATE_EVENT }
export type { MockOpenCreateDetail }

interface MockConfigProps {
  mockRules: MockRule[]
  fetchMocks: () => Promise<void>
  createMock: (rule: Omit<MockRule, 'id'>) => Promise<MockRule | null>
  updateMock: (id: number, updates: Partial<MockRule>) => Promise<boolean>
  deleteMock: (id: number) => Promise<boolean>
  /** @deprecated Prefer MOCK_OPEN_CREATE_EVENT; kept for callers that still pass prop. */
  initialEditData?: Partial<MockRule> | null
  onInitialEditConsumed?: () => void
}

type EditorMode =
  | { kind: 'idle' }
  | { kind: 'create'; initialData?: Partial<MockRule>; nonce: number }
  | { kind: 'edit'; ruleId: number }

export function MockConfig({
  mockRules,
  fetchMocks,
  createMock,
  updateMock,
  deleteMock,
  initialEditData,
  onInitialEditConsumed,
}: MockConfigProps) {
  const [editor, setEditor] = useState<EditorMode>({ kind: 'idle' })

  useEffect(() => {
    void fetchMocks()
  }, [fetchMocks])

  const openCreate = useCallback((initialData?: Partial<MockRule>) => {
    setEditor({ kind: 'create', initialData, nonce: Date.now() })
  }, [])

  const openEdit = useCallback((rule: MockRule) => {
    setEditor({ kind: 'edit', ruleId: rule.id })
  }, [])

  const closeEditor = useCallback(() => {
    setEditor({ kind: 'idle' })
  }, [])

  // Traffic → one-click create (and prop-based legacy entry)
  useEffect(() => {
    const onOpenCreate = (event: Event) => {
      const detail = (event as CustomEvent<MockOpenCreateDetail>).detail
      openCreate(detail?.initialData)
    }
    window.addEventListener(MOCK_OPEN_CREATE_EVENT, onOpenCreate)
    return () => window.removeEventListener(MOCK_OPEN_CREATE_EVENT, onOpenCreate)
  }, [openCreate])

  useEffect(() => {
    if (initialEditData) {
      openCreate(initialEditData)
      onInitialEditConsumed?.()
    }
  }, [initialEditData, onInitialEditConsumed, openCreate])

  const editingRule = useMemo(() => {
    if (editor.kind !== 'edit') return undefined
    return mockRules.find((rule) => rule.id === editor.ruleId)
  }, [editor, mockRules])

  // If edited rule was deleted elsewhere, return to idle
  useEffect(() => {
    if (editor.kind === 'edit' && !editingRule) {
      setEditor({ kind: 'idle' })
    }
  }, [editor.kind, editingRule])

  const handleToggle = useCallback(
    async (rule: MockRule, enabled: boolean) => {
      await updateMock(rule.id, { enabled })
    },
    [updateMock],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm('确定删除这条 Mock 规则？')) return
      const ok = await deleteMock(id)
      if (ok) {
        toast.success('已删除 Mock 规则')
        if (editor.kind === 'edit' && editor.ruleId === id) {
          closeEditor()
        }
      } else {
        toast.error('删除失败')
      }
    },
    [closeEditor, deleteMock, editor],
  )

  const handleSaved = useCallback(() => {
    void fetchMocks()
    closeEditor()
  }, [closeEditor, fetchMocks])

  const editorKey =
    editor.kind === 'create'
      ? `create-${editor.nonce}`
      : editor.kind === 'edit'
        ? `edit-${editor.ruleId}`
        : 'idle'

  return (
    <div
      data-testid="mock-config-layout"
      data-layout="list-edit"
      className="flex h-full min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-1 pb-3">
        <div>
          <h3 className="text-sm font-medium">Mock 规则</h3>
          <p className="text-xs text-muted-foreground">左侧列表 · 右侧编辑（全宽配置，非流量 B）</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openCreate()} data-testid="mock-config-create">
          <Plus data-icon="inline-start" />
          新增规则
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,42%)_minmax(0,58%)]">
        {/* List pane */}
        <div
          data-testid="mock-config-list"
          className="meddle-thin-scroll flex min-h-0 flex-col overflow-y-auto border-b lg:border-b-0 lg:border-r"
        >
          <div className="px-1 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            列表
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border lg:rounded-none lg:border-0 lg:border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">启用</TableHead>
                  <TableHead className="w-16">方法</TableHead>
                  <TableHead>名称 / 匹配</TableHead>
                  <TableHead className="w-14">状态</TableHead>
                  <TableHead className="w-14">延迟</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      暂无 Mock 规则，点击「新增规则」或从流量详情一键创建
                    </TableCell>
                  </TableRow>
                ) : (
                  mockRules.map((rule) => {
                    const selected = editor.kind === 'edit' && editor.ruleId === rule.id
                    return (
                      <TableRow
                        key={rule.id}
                        data-testid={`mock-config-row-${rule.id}`}
                        data-state={selected ? 'selected' : undefined}
                        className={cn('cursor-pointer', selected && 'bg-muted')}
                        onClick={() => openEdit(rule)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={rule.enabled}
                            onCheckedChange={(checked) => handleToggle(rule, checked === true)}
                            aria-label={`启用 ${rule.name || rule.urlPattern}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {rule.method || '*'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="truncate text-sm font-medium">
                            {rule.name || <span className="italic text-muted-foreground">未命名</span>}
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground" title={rule.urlPattern}>
                            {rule.urlPattern}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rule.statusCode >= 400 ? 'destructive' : rule.statusCode >= 300 ? 'secondary' : 'default'
                            }
                          >
                            {rule.statusCode}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {rule.delay ? `${rule.delay}ms` : '0ms'}
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            {rule.bodyType === 'file' ? (
                              <FileText className="size-3.5 text-muted-foreground" aria-hidden />
                            ) : (
                              <Code className="size-3.5 text-muted-foreground" aria-hidden />
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void handleDelete(rule.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="删除 Mock 规则"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Edit pane */}
        <div
          data-testid="mock-config-edit"
          className="meddle-thin-scroll flex min-h-0 flex-col overflow-hidden bg-muted/20"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {editor.kind === 'create'
                ? '编辑 Mock · 新建'
                : editor.kind === 'edit'
                  ? `编辑 Mock · ${editingRule?.name || editingRule?.urlPattern || editor.ruleId}`
                  : '编辑 Mock'}
            </div>
            {editor.kind !== 'idle' ? (
              <Button variant="ghost" size="xs" onClick={closeEditor}>
                取消
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {editor.kind === 'idle' ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <p>选择左侧规则进行编辑，或点击「新增规则」</p>
                <p className="text-xs">从流量详情「创建 Mock」会打开本编辑器并预填 URL / 方法 / Body</p>
              </div>
            ) : editor.kind === 'create' ? (
              <MockEditorPanel
                key={editorKey}
                initialData={editor.initialData}
                createMock={createMock}
                updateMock={updateMock}
                onSaved={handleSaved}
              />
            ) : editingRule ? (
              <MockEditorPanel
                key={editorKey}
                rule={editingRule}
                createMock={createMock}
                updateMock={updateMock}
                onSaved={handleSaved}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

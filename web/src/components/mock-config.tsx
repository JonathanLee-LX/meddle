/**
 * Mock config — full-width list | edit (modules/02-mock).
 * Not traffic B: config-page internal split. Traffic → one-click create lands here with prefill.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, FileText, Code } from 'lucide-react'
import type { MockRule } from '@/types'
import type { MockWriteOptions } from '@/hooks/use-mocks'
import { MockEditorPanel } from '@/components/mock-editor-panel'
import { toast } from '@/components/ui/toast'
import { MOCK_OPEN_CREATE_EVENT, type MockOpenCreateDetail } from '@/lib/mock-config-events'
import { SplitPane } from '@/components/split-pane'
import { EditorTitleBar, PaneBar, PaneTitle } from '@/components/pane-bar'
import { useEditorScrolled } from '@/hooks/use-editor-scrolled'
import { EditorPaneActionsProvider } from '@/components/editor-pane-actions'
import { mockPaneSplit } from '@/lib/mock-pane-split'
import { MocksFileInvalidEmptyState, MocksFileMissingEmptyState } from '@/components/mocks-file-missing-note'
import { MOCKS_FILE_STATUS_CHANGED_EVENT, formatMocksParseLocation, isMocksFileInvalid, shouldShowMocksFileMissing, useMocksFileStatus } from '@/hooks/use-mocks-file-status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const INVALID_FILE_CREATE_HINT = 'Mock 文件格式错误，修复后才能新增'

export { MOCK_OPEN_CREATE_EVENT }
export type { MockOpenCreateDetail }

interface MockConfigProps {
  mockRules: MockRule[]
  fetchMocks: () => Promise<void>
  createMock: (rule: Omit<MockRule, 'id'>, opts?: MockWriteOptions) => Promise<MockRule | null>
  updateMock: (id: number, updates: Partial<MockRule>, opts?: MockWriteOptions) => Promise<boolean>
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
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null)
  // Re-check when the rule count changes (e.g. the first save creates the file).
  const { status: mocksFile } = useMocksFileStatus(mockRules.length)

  useEffect(() => {
    void fetchMocks()
  }, [fetchMocks])

  const fileInvalid = isMocksFileInvalid(mocksFile)
  const fileInvalidRef = useRef(fileInvalid)
  useEffect(() => {
    fileInvalidRef.current = fileInvalid
    // Issue #123: an editor opened before the file broke stays open (unsaved
    // input kept); MockEditorPanel disables 「保存」 until the file is fixed.
  }, [fileInvalid])
  const fileInvalidLocation = isMocksFileInvalid(mocksFile) ? formatMocksParseLocation(mocksFile.parseError) : null

  const openCreate = useCallback((initialData?: Partial<MockRule>) => {
    // Issue #120: the server refuses writes while the file is broken.
    if (fileInvalidRef.current) {
      toast.error(INVALID_FILE_CREATE_HINT)
      return
    }
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

  // Issue #123: while the file is broken the list is empty; keep editing the
  // last known copy of the rule instead of closing the editor.
  const [lastEditingRule, setLastEditingRule] = useState<MockRule | undefined>(undefined)
  const foundEditingRule = useMemo(() => {
    if (editor.kind !== 'edit') return undefined
    return mockRules.find((rule) => rule.id === editor.ruleId)
  }, [editor, mockRules])
  useEffect(() => {
    if (foundEditingRule) setLastEditingRule(foundEditingRule)
  }, [foundEditingRule])
  // Issue #123: a rule missing from the list may just mean the file broke
  // (list emptied before the status arrives). Keep editing the last known copy
  // and only close once a fresh, valid file status confirms it is gone.
  const editingMissing = editor.kind === 'edit' && !foundEditingRule
  const missSinceRef = useRef<{ status: typeof mocksFile } | null>(null)
  useEffect(() => {
    if (!editingMissing) { missSinceRef.current = null; return }
    // Remember which status was current when the rule vanished, then re-check it.
    missSinceRef.current = { status: mocksFile }
    window.dispatchEvent(new CustomEvent(MOCKS_FILE_STATUS_CHANGED_EVENT))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on miss transitions
  }, [editingMissing])
  const editingRule =
    foundEditingRule ??
    (editor.kind === 'edit' && lastEditingRule?.id === editor.ruleId ? lastEditingRule : undefined)

  // If edited rule was deleted elsewhere, return to idle
  useEffect(() => {
    if (!editingMissing) return
    const since = missSinceRef.current
    const confirmedGone = !lastEditingRule || lastEditingRule.id !== (editor.kind === 'edit' ? editor.ruleId : -1)
      || (since !== null && mocksFile !== since.status && !fileInvalid)
    if (confirmedGone) setEditor({ kind: 'idle' })
  }, [editingMissing, editor, lastEditingRule, mocksFile, fileInvalid])

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
  const editorScroll = useEditorScrolled(editorKey)

  return (
    <SplitPane
      testId="mock-config-layout"
      layout="list-edit"
      widthAttr="mock-list-width"
      split={mockPaneSplit}
      listTestId="mock-config-list"
      panelTestId="mock-config-edit"
      separatorTestId="mock-panel-separator"
      separatorLabel="调整 Mock 列表宽度"
      list={
      <>
        <PaneBar>
          <PaneTitle>Mock 规则</PaneTitle>
          {fileInvalid ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons get no pointer events; the wrapper carries the tooltip. */}
                <span tabIndex={0} data-testid="mock-config-create-wrapper" aria-label={INVALID_FILE_CREATE_HINT}>
                  <Button variant="outline" size="sm" disabled data-testid="mock-config-create" className="pointer-events-none">
                    <Plus data-icon="inline-start" />
                    新增规则
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent data-testid="mock-config-create-tooltip">{INVALID_FILE_CREATE_HINT}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="outline" size="sm" onClick={() => openCreate()} data-testid="mock-config-create">
              <Plus data-icon="inline-start" />
              新增规则
            </Button>
          )}
        </PaneBar>
        <div className="meddle-thin-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground whitespace-normal">
                      {isMocksFileInvalid(mocksFile) ? (
                        <MocksFileInvalidEmptyState
                          path={mocksFile.path}
                          location={formatMocksParseLocation(mocksFile.parseError)}
                        />
                      ) : shouldShowMocksFileMissing(mocksFile) ? (
                        <MocksFileMissingEmptyState path={mocksFile.path}>
                          暂无 Mock 规则，点击「新增规则」或从流量详情一键创建
                        </MocksFileMissingEmptyState>
                      ) : (
                        '暂无 Mock 规则，点击「新增规则」或从流量详情一键创建'
                      )}
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
                        className="cursor-pointer"
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
      </>
      }
    >
        <EditorTitleBar
          data-testid="mock-editor-title-bar"
          scrolled={editorScroll.scrolled}
          title={
            editor.kind === 'create'
              ? '编辑 Mock · 新建'
              : editor.kind === 'edit'
                ? `编辑 Mock · ${editingRule?.name || editingRule?.urlPattern || editor.ruleId}`
                : '编辑 Mock'
          }
          actions={
            <>
              {editor.kind !== 'idle' ? (
                <Button variant="ghost" size="sm" onClick={closeEditor}>
                  取消
                </Button>
              ) : null}
              <div ref={setActionsHost} data-testid="editor-pane-actions" className="contents" />
            </>
          }
        />
          <EditorPaneActionsProvider host={actionsHost}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {editor.kind === 'idle' ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <p>选择左侧规则进行编辑，或点击「新增规则」</p>
                <p className="text-xs">从流量详情「创建 Mock」会打开本编辑器并预填 URL / 方法 / Body</p>
              </div>
            ) : editor.kind === 'create' ? (
              <MockEditorPanel
                key={editorKey}
                onBodyScroll={editorScroll.onScroll}
                initialData={editor.initialData}
                createMock={createMock}
                updateMock={updateMock}
                onSaved={handleSaved}
                fileInvalidLocation={fileInvalidLocation}
              />
            ) : editingRule ? (
              <MockEditorPanel
                key={editorKey}
                onBodyScroll={editorScroll.onScroll}
                rule={editingRule}
                createMock={createMock}
                updateMock={updateMock}
                onSaved={handleSaved}
                fileInvalidLocation={fileInvalidLocation}
              />
            ) : null}
          </div>
          </EditorPaneActionsProvider>
    </SplitPane>
  )
}

import { useEffect, useCallback, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { FileUp, Wand2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Plus, Trash2, Pencil, FileText, Code, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { MonacoEditor } from '@/components/monaco-editor'
import { formatContent } from '@/lib/formatter'
import { validateContent } from '@/lib/syntax-highlight'
import { fixCode } from '@/lib/code-fixer'
import { getAIConfig, isAIConfigValid } from '@/lib/ai-config-store'
import type { MockRule } from '@/types'
import { supportsOpenFilePicker } from '@/types/file-system-access'

// 判断是否为 Base64 图片
function isBase64Image(content: string): boolean {
  return content.trim().startsWith('data:image/')
}

interface MockConfigProps {
  mockRules: MockRule[]
  fetchMocks: () => Promise<void>
  createMock: (rule: Omit<MockRule, 'id'>) => Promise<MockRule | null>
  updateMock: (id: number, updates: Partial<MockRule>) => Promise<boolean>
  deleteMock: (id: number) => Promise<boolean>
  /** 外部传入的初始编辑数据（从日志详情创建 mock 时使用） */
  initialEditData?: Partial<MockRule> | null
  onInitialEditConsumed?: () => void
}

const EMPTY_RULE: Omit<MockRule, 'id'> = {
  name: '',
  urlPattern: '',
  method: '*',
  statusCode: 200,
  delay: 0,
  bodyType: 'inline',
  headers: {},
  body: '',
  enabled: true,
}

export function MockConfig({
  mockRules,
  fetchMocks,
  createMock,
  updateMock,
  deleteMock,
  initialEditData,
  onInitialEditConsumed,
}: MockConfigProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [editId] = useState<number | null>(null) // null = create, number = edit
  const [editForm, setEditForm] = useState<Omit<MockRule, 'id'>>(EMPTY_RULE)
  const [saving, setSaving] = useState(false)
  const [headersExpanded, setHeadersExpanded] = useState(false)
  const [editorHeight, setEditorHeight] = useState(300) // 编辑器高度（像素）
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [headerKey, setHeaderKey] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [formatError, setFormatError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [fixing, setFixing] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [suggestedContentType, setSuggestedContentType] = useState<string | null>(null)

  // 判断是否为图片类型
  const isImageType = (file: File): boolean => {
    return file.type.startsWith('image/')
  }

  // 根据文件扩展名获取 Content-Type
  const getContentType = (filename: string): string => {
    const ext = filename.toLowerCase().split('.').pop() || ''
    const contentTypes: Record<string, string> = {
      'json': 'application/json',
      'js': 'application/javascript',
      'css': 'text/css',
      'html': 'text/html',
      'htm': 'text/html',
      'xml': 'application/xml',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'bmp': 'image/bmp',
    }
    return contentTypes[ext] || 'text/plain'
  }

  // 检测建议的 Content-Type
  const getSuggestedContentType = (filename: string): string | null => {
    const contentType = getContentType(filename)
    const currentHeaders = editForm.headers || {}
    // 如果当前没有 Content-Type，返回建议值
    if (!currentHeaders['Content-Type']) {
      return contentType
    }
    return null
  }

  // 读取文件内容（图片转Base64，文本直接读取）
  const readFileContent = async (file: File): Promise<string> => {
    if (isImageType(file)) {
      // 图片转Base64
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          resolve(e.target?.result as string)
        }
        reader.readAsDataURL(file)
      })
    } else {
      // 文本直接读取
      return await file.text()
    }
  }

  // 使用系统文件选择器选择文件
  const handleSelectFile = useCallback(async () => {
    // 优先尝试使用 File System Access API
    if (supportsOpenFilePicker(window)) {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [
            {
              description: '响应文件',
              accept: {
                'application/json': ['.json'],
                'text/html': ['.html', '.htm'],
                'text/plain': ['.txt', '.js', '.css', '.xml', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp'],
                'image/png': ['.png'],
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/gif': ['.gif'],
                'image/webp': ['.webp'],
              },
            },
          ],
          multiple: false,
        })
        const file = await fileHandle.getFile()
        const content = await readFileContent(file)
        updateField('body', content)
        setSuggestedContentType(getSuggestedContentType(file.name))
        return
      } catch (err) {
        console.log('File System Access API not available or cancelled:', err)
      }
    }
    // 回退：使用传统文件选择器
    fileInputRef.current?.click()
  }, [])

  // 处理传统文件 input 的选择
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      readFileContent(file).then(content => {
        updateField('body', content)
        setSuggestedContentType(getSuggestedContentType(file.name))
      })
    }
    // 重置 input 以便可以再次选择相同文件
    e.target.value = ''
  }, [])

  useEffect(() => {
    void fetchMocks()
  }, [fetchMocks])

  // 处理外部传入的初始编辑数据
  useEffect(() => {
    if (initialEditData) {
      window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
        detail: {
          id: 'mock.create',
          title: '新建 Mock 规则',
          size: 'lg',
          params: { initialData: initialEditData },
        },
      }))
      onInitialEditConsumed?.()
    }
  }, [initialEditData, onInitialEditConsumed])

  // 关闭编辑面板时重置状态
  useEffect(() => {
    if (!editOpen) {
      setHeaderKey('')
      setHeaderValue('')
      setHeadersExpanded(false)
      setValidationError(null)
      setFormatError(null)
    }
  }, [editOpen])

  // 验证body内容
  const validateBody = useCallback((body: string) => {
    if (!body.trim()) {
      setValidationError(null)
      return
    }

    const result = validateContent(body)
    if (!result.valid) {
      setValidationError(result.error || '内容格式错误')
    } else {
      setValidationError(null)
    }
  }, [])

  const openCreate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
      detail: { id: 'mock.create', title: '新建 Mock 规则', size: 'lg' },
    }))
  }, [])

  const openEdit = useCallback((rule: MockRule) => {
    window.dispatchEvent(new CustomEvent('global-panel:open-panel', {
      detail: {
        id: 'mock.edit',
        title: `编辑 Mock：${rule.name || rule.urlPattern}`,
        size: 'lg',
        params: { id: rule.id },
      },
    }))
  }, [])

  // 拖拽调整编辑器高度
  const handleEditorResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = editorHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(150, startHeight + deltaY) // 最小高度 150px
      setEditorHeight(newHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [editorHeight])

  const handleSave = useCallback(async () => {
    // 在保存前进行最终验证
    if (editForm.bodyType === 'inline' && editForm.body.trim()) {
      const result = validateContent(editForm.body)
      if (!result.valid) {
        setValidationError(result.error || '内容格式错误')
        return
      }
    }

    setSaving(true)
    if (editId != null) {
      await updateMock(editId, editForm)
    } else {
      await createMock(editForm)
    }
    setSaving(false)
    setEditOpen(false)
  }, [editId, editForm, createMock, updateMock])

  const handleToggle = useCallback(
    async (rule: MockRule, enabled: boolean) => {
      await updateMock(rule.id, { enabled })
    },
    [updateMock],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      await deleteMock(id)
    },
    [deleteMock],
  )

  const updateField = <K extends keyof Omit<MockRule, 'id'>>(field: K, value: Omit<MockRule, 'id'>[K]) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
    
    // 当更新body时进行实时验证
    if (field === 'body' && typeof value === 'string') {
      validateBody(value)
    }
  }

  // 自动格式化 body（使用 Prettier）
  const formatBody = useCallback(async () => {
    setFormatting(true)
    try {
      const { formatted, type } = await formatContent(editForm.body)
      updateField('body', formatted)
      setFormatError(null)
      console.log(`已格式化为 ${type}`)
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : '格式化失败')
      setTimeout(() => setFormatError(null), 3000)
    } finally {
      setFormatting(false)
    }
  }, [editForm.body])

  // AI自动修复语法错误
  const fixBodyErrors = useCallback(async () => {
    setFixing(true)
    try {
      const result = await fixCode(editForm.body, true)
      if (result.success) {
        updateField('body', result.fixed)
        setValidationError(null)
        setFormatError(null)
        console.log(`代码已修复 (方法: ${result.method === 'ai' ? 'AI' : '规则'})`)
      } else {
        setFormatError('自动修复失败,请手动修正语法错误')
        setTimeout(() => setFormatError(null), 3000)
      }
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : '修复失败')
      setTimeout(() => setFormatError(null), 3000)
    } finally {
      setFixing(false)
    }
  }, [editForm.body])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Mock 规则配置
          <span className="ml-2 text-xs">
            匹配请求后直接返回预设响应，不再转发到真实服务器
          </span>
        </h3>
        <Button variant="outline" size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          新增规则
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">启用</TableHead>
              <TableHead className="w-40">名称</TableHead>
              <TableHead>URL 匹配</TableHead>
              <TableHead className="w-20">方法</TableHead>
              <TableHead className="w-20">状态码</TableHead>
              <TableHead className="w-16">类型</TableHead>
              <TableHead className="w-16">延迟</TableHead>
              <TableHead className="w-16">响应头</TableHead>
              <TableHead className="w-20">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  暂无 Mock 规则，点击"新增规则"或从请求日志详情中创建
                </TableCell>
              </TableRow>
            ) : (
              mockRules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <Checkbox
                      checked={rule.enabled}
                      onCheckedChange={(checked) => handleToggle(rule, checked === true)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {rule.name || <span className="text-muted-foreground italic">未命名</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[300px]" title={rule.urlPattern}>
                    {rule.urlPattern}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {rule.method || '*'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        rule.statusCode >= 200 && rule.statusCode < 300
                          ? 'text-green-600'
                          : rule.statusCode >= 400
                          ? 'text-red-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {rule.statusCode}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {rule.bodyType === 'file' ? (
                      <Badge variant="outline" className="text-xs text-blue-600">
                        <FileText className="h-3 w-3 mr-0.5" />文件
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Code className="h-3 w-3 mr-0.5" />内容
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {rule.delay ? `${rule.delay}ms` : '-'}
                  </TableCell>
                  <TableCell>
                    {rule.headers && Object.keys(rule.headers).length > 0 ? (
                      <Badge variant="secondary" className="text-xs">
                        {Object.keys(rule.headers).length}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(rule)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(rule.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 编辑面板 */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="p-0 flex flex-col" resizable defaultWidth={700} storageKey="mock-config-editor">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-base">
              {editId != null ? '编辑 Mock 规则' : '新建 Mock 规则'}
            </SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
            {/* 名称 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">规则名称</label>
              <Input
                value={editForm.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="如：模拟欠费状态"
                className="h-8"
              />
            </div>
            {/* URL 匹配 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                URL 匹配（支持正则）
              </label>
              <Input
                value={editForm.urlPattern}
                onChange={(e) => updateField('urlPattern', e.target.value)}
                placeholder="如：/api/console/user/corp/.*"
                className="h-8 font-mono text-sm"
              />
            </div>
            {/* 方法和状态码 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">HTTP 方法</label>
                <select
                  value={editForm.method}
                  onChange={(e) => updateField('method', e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="*">全部</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">响应状态码</label>
                <Input
                  type="number"
                  value={editForm.statusCode}
                  onChange={(e) => updateField('statusCode', parseInt(e.target.value) || 200)}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">响应延迟 (ms)</label>
                <Input
                  type="number"
                  value={editForm.delay}
                  onChange={(e) => updateField('delay', parseInt(e.target.value) || 0)}
                  placeholder="0"
                  className="h-8"
                />
              </div>
            </div>
            {/* 响应 Body */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">响应内容 (Body)</label>
                <div className="flex items-center gap-2">
                  {/* 从文件加载按钮 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={handleSelectFile}
                  >
                    <FileUp className="h-3 w-3 mr-1" />
                    从文件加载
                  </Button>
                  {/* 从URL导入按钮 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={async () => {
                      const url = window.prompt('请输入文件 URL:')
                      if (url) {
                        try {
                          const response = await fetch(url)
                          const contentType = response.headers.get('content-type') || ''

                          // 检测是否为图片
                          if (contentType.startsWith('image/') || url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i)) {
                            // 图片转Base64
                            const blob = await response.blob()
                            const reader = new FileReader()
                            reader.onload = () => {
                              updateField('body', reader.result as string)
                            }
                            reader.readAsDataURL(blob)
                          } else {
                            // 文本内容
                            const content = await response.text()
                            updateField('body', content)
                          }
                        } catch (error) {
                          alert('无法加载文件: ' + (error as Error).message)
                        }
                      }
                    }}
                  >
                    <FileUp className="h-3 w-3 mr-1" />
                    从URL导入
                  </Button>
                  {formatError && (
                    <span className="text-xs text-red-500">{formatError}</span>
                  )}
                  {/* AI修复按钮 - 当有内容时显示 */}
                  {editForm.body.trim() && isAIConfigValid(getAIConfig()) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={fixBodyErrors}
                      disabled={fixing}
                    >
                      <Wand2 className="h-3 w-3 mr-1" />
                      {fixing ? '修复中...' : 'AI修复'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={formatBody}
                    disabled={formatting}
                  >
                    <Code className="h-3 w-3 mr-1" />
                    {formatting ? '格式化中...' : '智能格式化'}
                  </Button>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
                accept="image/*,.json,.html,.htm,.txt,.js,.css,.xml,.csv"
              />
              {/* 图片内容显示预览 */}
              {editForm.body.trim() && isBase64Image(editForm.body) ? (
                <div className="space-y-2">
                  <div className="border rounded-md p-2 bg-muted/30">
                    <img
                      src={editForm.body}
                      alt="Preview"
                      className="max-w-full max-h-96 object-contain"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => updateField('body', '')}
                    >
                      删除图片
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => {
                        // 复制Base64内容到剪贴板
                        navigator.clipboard.writeText(editForm.body)
                        alert('图片内容已复制到剪贴板')
                      }}
                    >
                      复制内容
                    </Button>
                  </div>
                </div>
              ) : (
                <div ref={editorRef} className="relative group">
                  <MonacoEditor
                    value={editForm.body}
                    onChange={(v) => updateField('body', v)}
                    placeholder='支持 JSON, HTML, JS, CSS 等格式，或从文件/URL导入'
                    height={`${editorHeight}px`}
                  />
                  {/* 拖拽调整高度手柄 */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-border/50 to-transparent"
                    onMouseDown={handleEditorResize}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              )}
              {validationError && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">语法错误：</span>
                  <span className="text-xs text-red-600 dark:text-red-400 flex-1">{validationError}</span>
                </div>
              )}
            </div>
            {/* Response Headers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setHeadersExpanded(!headersExpanded)}
                >
                  {headersExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  响应头 (Headers)
                  {Object.keys(editForm.headers || {}).length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {Object.keys(editForm.headers || {}).length}
                    </Badge>
                  )}
                </button>
                {/* Content-Type 建议更新提示 */}
                {suggestedContentType && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-amber-600 dark:text-amber-400">
                      检测到内容类型变更，建议更新为 {suggestedContentType}?
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => {
                        const currentHeaders = editForm.headers || {}
                        updateField('headers', { ...currentHeaders, 'Content-Type': suggestedContentType })
                        setSuggestedContentType(null)
                      }}
                    >
                      更新
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setSuggestedContentType(null)}
                    >
                      忽略
                    </Button>
                  </div>
                )}
              </div>
              {headersExpanded && (
                <div className="space-y-2 pl-4 border-l-2 border-muted">
                  {/* 已添加的 headers 列表 */}
                  {Object.entries(editForm.headers || {}).length > 0 ? (
                    <div className="space-y-1">
                      {Object.entries(editForm.headers || {}).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <Input
                            value={key}
                            onChange={(e) => {
                              const newHeaders = { ...editForm.headers }
                              delete newHeaders[key]
                              if (e.target.value) {
                                newHeaders[e.target.value] = value
                              }
                              updateField('headers', newHeaders)
                            }}
                            placeholder="Header 名称"
                            className="h-7 font-mono text-xs flex-1"
                          />
                          <Input
                            value={value}
                            onChange={(e) => {
                              updateField('headers', { ...editForm.headers, [key]: e.target.value })
                            }}
                            placeholder="Header 值"
                            className="h-7 font-mono text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              const newHeaders = { ...editForm.headers }
                              delete newHeaders[key]
                              updateField('headers', newHeaders)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">暂无自定义响应头</p>
                  )}
                  {/* 新增 header */}
                  <div className="flex items-center gap-2">
                    <Input
                      value={headerKey}
                      onChange={(e) => setHeaderKey(e.target.value)}
                      placeholder="Header 名称"
                      className="h-7 font-mono text-xs flex-1"
                    />
                    <Input
                      value={headerValue}
                      onChange={(e) => setHeaderValue(e.target.value)}
                      placeholder="Header 值"
                      className="h-7 font-mono text-xs flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => {
                        if (headerKey && headerValue) {
                          updateField('headers', { ...editForm.headers, [headerKey]: headerValue })
                          setHeaderKey('')
                          setHeaderValue('')
                        }
                      }}
                      disabled={!headerKey || !headerValue}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {/* 启用 */}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={editForm.enabled}
                onCheckedChange={(checked) => updateField('enabled', !!checked)}
              />
              <label className="text-sm">启用此规则</label>
            </div>
          </div>
          <Separator />
          <div className="px-4 py-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !editForm.urlPattern}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

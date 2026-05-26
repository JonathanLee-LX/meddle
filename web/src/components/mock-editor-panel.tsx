import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Code, GripVertical, Loader2, Save, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { fixCode } from '@/lib/code-fixer'
import { formatContent } from '@/lib/formatter'
import { getAIConfig, isAIConfigValid } from '@/lib/ai-config-store'
import { validateContent } from '@/lib/syntax-highlight'
import type { MockRule } from '@/types'
import { MonacoEditor } from './monaco-editor'

interface MockEditorPanelProps {
  rule?: MockRule
  initialData?: Partial<MockRule>
  createMock: (rule: Omit<MockRule, 'id'>) => Promise<MockRule | null>
  updateMock: (id: number, updates: Partial<MockRule>) => Promise<boolean>
  onSaved?: () => void
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

export function MockEditorPanel({
  rule,
  initialData,
  createMock,
  updateMock,
  onSaved,
}: MockEditorPanelProps) {
  const initialForm = useMemo<Omit<MockRule, 'id'>>(() => {
    if (rule) {
      return {
        name: rule.name,
        urlPattern: rule.urlPattern,
        method: rule.method,
        statusCode: rule.statusCode,
        delay: rule.delay || 0,
        bodyType: rule.bodyType || 'inline',
        headers: rule.headers || {},
        body: rule.body,
        enabled: rule.enabled,
      }
    }
    return { ...EMPTY_RULE, ...initialData }
  }, [initialData, rule])

  const [form, setForm] = useState<Omit<MockRule, 'id'>>(initialForm)
  const [headersText, setHeadersText] = useState(() => JSON.stringify(initialForm.headers || {}, null, 2))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [fixing, setFixing] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [editorHeight, setEditorHeight] = useState(300)
  const isAIReady = isAIConfigValid(getAIConfig())

  const validateBody = useCallback((body: string) => {
    if (!body.trim()) {
      setValidationError(null)
      return
    }

    const result = validateContent(body)
    setValidationError(result.valid ? null : result.error || '内容格式错误')
  }, [])

  const updateField = <K extends keyof Omit<MockRule, 'id'>>(field: K, value: Omit<MockRule, 'id'>[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))

    if (field === 'body' && typeof value === 'string') {
      validateBody(value)
    }
  }

  const handleEditorResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = editorHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      setEditorHeight(Math.max(150, startHeight + deltaY))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [editorHeight])

  const formatBody = async () => {
    if (!form.body.trim() || formatting) return

    setFormatting(true)
    setFormatError(null)
    try {
      const { formatted } = await formatContent(form.body)
      updateField('body', formatted)
    } catch (err) {
      setFormatError(err instanceof Error ? err.message : '格式化失败')
      window.setTimeout(() => setFormatError(null), 3000)
    } finally {
      setFormatting(false)
    }
  }

  const fixBodyErrors = async () => {
    if (!form.body.trim() || fixing || !isAIReady) return

    setFixing(true)
    setFormatError(null)
    try {
      const result = await fixCode(form.body, true)
      if (!result.success) {
        throw new Error('自动修复失败，请手动修正语法错误')
      }
      updateField('body', result.fixed)
      setValidationError(null)
    } catch (err) {
      setFormatError(err instanceof Error ? err.message : '修复失败')
      window.setTimeout(() => setFormatError(null), 3000)
    } finally {
      setFixing(false)
    }
  }

  const handleSave = async () => {
    if (!form.urlPattern.trim()) {
      setError('请填写 URL 匹配')
      return
    }

    if (form.bodyType === 'inline' && form.body.trim()) {
      const result = validateContent(form.body)
      if (!result.valid) {
        setValidationError(result.error || '内容格式错误')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      let headers: Record<string, string> = {}
      if (headersText.trim()) {
        const parsed = JSON.parse(headersText) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('响应头必须是 JSON 对象')
        }
        headers = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
      }

      const payload = { ...form, headers }
      if (rule) {
        await updateMock(rule.id, payload)
      } else {
        await createMock(payload)
      }
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>规则名称</Label>
            <Input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="如：模拟欠费状态"
            />
          </div>
          <div className="space-y-2">
            <Label>HTTP 方法</Label>
            <select
              value={form.method}
              onChange={(event) => updateField('method', event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="*">全部</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>URL 匹配（支持正则）</Label>
          <Input
            value={form.urlPattern}
            onChange={(event) => updateField('urlPattern', event.target.value)}
            placeholder="如：/api/console/user/corp/.*"
            className="font-mono"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>响应状态码</Label>
            <Input
              type="number"
              value={form.statusCode}
              onChange={(event) => updateField('statusCode', parseInt(event.target.value) || 200)}
            />
          </div>
          <div className="space-y-2">
            <Label>响应延迟 (ms)</Label>
            <Input
              type="number"
              value={form.delay}
              onChange={(event) => updateField('delay', parseInt(event.target.value) || 0)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>响应头 JSON</Label>
          <Textarea
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
            className="min-h-[96px] font-mono text-xs"
            placeholder='{"Content-Type":"application/json"}'
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>响应内容</Label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {formatError && (
                <span className="max-w-[280px] truncate text-xs text-red-500" title={formatError}>
                  {formatError}
                </span>
              )}
              {form.body.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={fixBodyErrors}
                  disabled={fixing || !isAIReady}
                  title={!isAIReady ? 'AI 未配置或未启用' : '使用 AI 修复响应内容'}
                >
                  {fixing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}
                  {fixing ? '修复中...' : 'AI修复'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={formatBody}
                disabled={formatting || !form.body.trim()}
                title="格式化响应内容"
              >
                {formatting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Code className="mr-1 h-3 w-3" />}
                {formatting ? '格式化中...' : '代码格式化'}
              </Button>
            </div>
          </div>
          <div className="relative group" style={{ height: `${editorHeight}px` }}>
            <MonacoEditor
              value={form.body}
              onChange={(value) => updateField('body', value)}
              placeholder="支持 JSON、HTML、JS、CSS 等响应内容"
              height="flex"
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-border/50 to-transparent"
              onMouseDown={handleEditorResize}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          {validationError && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">语法错误：</span>
              <span className="text-xs text-red-600 dark:text-red-400 flex-1">{validationError}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox checked={form.enabled} onCheckedChange={(checked) => updateField('enabled', !!checked)} />
          <Label className="text-sm">启用此规则</Label>
        </div>
      </div>

      <Separator />

      <div className="flex justify-end gap-2 px-5 py-3">
        <Button onClick={handleSave} disabled={saving || !form.urlPattern.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </div>
  )
}

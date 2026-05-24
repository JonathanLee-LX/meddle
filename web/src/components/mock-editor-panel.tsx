import { useMemo, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { MockRule } from '@/types'

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

  const updateField = <K extends keyof Omit<MockRule, 'id'>>(field: K, value: Omit<MockRule, 'id'>[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!form.urlPattern.trim()) {
      setError('请填写 URL 匹配')
      return
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
          <Label>响应内容</Label>
          <Textarea
            value={form.body}
            onChange={(event) => updateField('body', event.target.value)}
            className="min-h-[220px] font-mono text-xs"
            placeholder="支持 JSON、HTML、JS、CSS 等响应内容"
          />
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

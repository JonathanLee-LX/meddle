import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MonacoEditor } from './monaco-editor'
import { getAIConfig, getActiveModel, isAIConfigValid } from '@/lib/ai-config-store'
import { Code2, Save, Loader2, Zap, RotateCcw, PencilLine } from 'lucide-react'

interface PluginCodeEditorProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  embedded?: boolean
  filename: string
  onSaved?: () => void
}

export function PluginCodeEditor({
  open = false,
  onOpenChange,
  embedded = false,
  filename,
  onSaved,
}: PluginCodeEditorProps) {
  const [code, setCode] = useState('')
  const [originalCode, setOriginalCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [revising, setRevising] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraInstruction, setExtraInstruction] = useState('')
  const [reviseStatus, setReviseStatus] = useState<string | null>(null)
  const [aiReviseOpen, setAiReviseOpen] = useState(false)

  const isDirty = code !== originalCode
  const aiConfig = getAIConfig()
  const activeModel = getActiveModel(aiConfig)
  const effectiveAIConfig = activeModel ? {
    provider: activeModel.provider,
    apiKey: activeModel.apiKey,
    baseUrl: activeModel.baseUrl,
    model: activeModel.model,
  } : {
    provider: aiConfig.provider,
    apiKey: aiConfig.apiKey,
    baseUrl: aiConfig.baseUrl,
    model: aiConfig.model,
  }
  const isAIReady = isAIConfigValid(aiConfig)

  const fetchCode = useCallback(async () => {
    if (!filename) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/custom/${encodeURIComponent(filename)}/code`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '读取插件代码失败')
      }
      const data = await res.json()
      setCode(data.code)
      setOriginalCode(data.code)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [filename])

  useEffect(() => {
    if ((open || embedded) && filename) {
      fetchCode()
    }
  }, [open, embedded, filename, fetchCode])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/custom/${encodeURIComponent(filename)}/code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '保存失败')
      }
      setOriginalCode(code)
      window.dispatchEvent(new CustomEvent('plugins-custom-updated'))
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndReload = async () => {
    setSaving(true)
    setReloading(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/custom/${encodeURIComponent(filename)}/code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '保存失败')
      }
      setOriginalCode(code)

      const reloadRes = await fetch('/api/plugins/reload', { method: 'POST' })
      if (!reloadRes.ok) {
        throw new Error('热加载失败')
      }
      onSaved?.()
      window.dispatchEvent(new CustomEvent('plugins-custom-updated'))
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSaving(false)
      setReloading(false)
    }
  }

  const handleRevert = () => {
    setCode(originalCode)
  }

  const handleClose = () => {
    if (isDirty && !confirm('有未保存的修改，确定要关闭吗？')) return
    setAiReviseOpen(false)
    onOpenChange?.(false)
  }

  const handleAIRevise = async () => {
    if (!extraInstruction.trim() || !isAIReady) return

    setAiReviseOpen(true)
    setRevising(true)
    setError(null)
    setReviseStatus('AI 正在根据补充需求更新代码...')

    try {
      const reviseRes = await fetch('/api/plugins/revise-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalCode: code,
          instruction: extraInstruction.trim(),
          requirement: {
            name: filename.replace(/\.js$/i, ''),
            description: `根据补充要求更新插件 ${filename}，保持 Easy Proxy 插件结构和现有核心能力正确。`,
          },
          aiConfig: effectiveAIConfig,
        }),
      })

      if (!reviseRes.ok) {
        const data = await reviseRes.json()
        throw new Error(data.error || 'AI 更新代码失败')
      }

      const reader = reviseRes.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) {
        throw new Error('无法读取 AI 更新流')
      }

      let revisedCode = ''
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data) continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.status === 'generating') {
              setReviseStatus('AI 正在根据补充需求更新代码...')
            } else if (parsed.chunk) {
              revisedCode = parsed.accumulated || `${revisedCode}${parsed.chunk}`
              setCode(revisedCode)
              setReviseStatus(`生成中... ${revisedCode.length} 字符`)
            } else if (parsed.status === 'success') {
              revisedCode = parsed.revisedCode || revisedCode
              setCode(revisedCode)
              setReviseStatus('AI 已完成代码更新，请检查后保存。')
            } else if (parsed.error) {
              throw new Error(parsed.error)
            }
          } catch (err) {
            if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
              throw err
            }
          }
        }
      }

      if (!revisedCode.trim()) {
        throw new Error('AI 未返回有效代码')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 更新代码失败')
      setReviseStatus(null)
    } finally {
      setRevising(false)
    }
  }

  const body = (
    <>
        <SheetHeader className="px-6 pt-6 pb-3">
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            {filename}
            {isDirty && <Badge variant="outline" className="text-orange-600 border-orange-300">未保存</Badge>}
          </SheetTitle>
          <SheetDescription>查看和编辑插件源码，保存后需热加载才能生效</SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>加载中...</span>
            </div>
          ) : error && !code ? (
            <div className="flex flex-1 items-center justify-center text-destructive">
              {error}
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <div className="relative h-full min-h-[320px]">
                <MonacoEditor
                  value={code}
                  onChange={setCode}
                  language="javascript"
                  height="flex"
                />
              </div>
            </div>
          )}
        </div>

        <div
          aria-hidden={!aiReviseOpen}
          className={[
            'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
            aiReviseOpen ? 'max-h-[260px] border-t opacity-100' : 'max-h-0 border-t-0 opacity-0 pointer-events-none',
          ].join(' ')}
        >
          <div className="space-y-3 px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <PencilLine className="h-4 w-4" />
                  AI 更新代码
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  输入补充需求后，AI 会直接把结果写回当前编辑器。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setAiReviseOpen(false)}
                disabled={!aiReviseOpen || revising}
              >
                收起
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="plugin-editor-extra-instruction">补充需求信息</Label>
                <Textarea
                  id="plugin-editor-extra-instruction"
                  value={extraInstruction}
                  onChange={(e) => setExtraInstruction(e.target.value)}
                  placeholder="例如：补充 onBeforeResponse 对空 referer 的处理；保留现有 manifest 和 hook，不要改插件 id。"
                  className="min-h-[88px] resize-none"
                  disabled={!aiReviseOpen || revising || saving}
                />
              </div>
              <Button
                size="sm"
                onClick={handleAIRevise}
                disabled={!aiReviseOpen || !extraInstruction.trim() || !isAIReady || revising || saving}
                title={!isAIReady ? 'AI 未配置或未启用' : '根据补充需求更新当前代码'}
              >
                {revising ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    更新中...
                  </>
                ) : (
                  <>
                    <PencilLine className="h-4 w-4 mr-1" />
                    更新代码
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {reviseStatus || (isAIReady ? '生成结果会写回上方编辑器，请检查后再保存或热加载。' : 'AI 未配置或未启用，请先在设置中配置 AI 服务。')}
            </p>
          </div>
        </div>

        {error && code && (
          <div className="px-6 py-2 text-sm text-destructive bg-destructive/10">
            {error}
          </div>
        )}

        <Separator />

        <div className="px-6 py-3 flex justify-between items-center gap-2">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevert}
              disabled={!isDirty || saving || revising}
              title="撤销修改"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              还原
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAiReviseOpen((open) => !open)}
              disabled={!code || saving || revising}
              title={!isAIReady ? 'AI 未配置或未启用' : '使用 AI 根据补充需求更新代码'}
            >
              <PencilLine className="h-4 w-4 mr-1" />
              AI 更新代码
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={saving || revising}
            >
              关闭
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving || revising}
            >
              {saving && !reloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              保存
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAndReload}
              disabled={!isDirty || saving || revising}
            >
              {reloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              保存并热加载
            </Button>
          </div>
        </div>
    </>
  )

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{body}</div>
  }

  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v && isDirty && !confirm('有未保存的修改，确定要关闭吗？')) return
      if (!v) setAiReviseOpen(false)
      onOpenChange?.(v)
    }}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={900} storageKey="plugin-code-editor">
        {body}
      </SheetContent>
    </Sheet>
  )
}

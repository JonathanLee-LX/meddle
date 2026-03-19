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
import { Code2, Save, Loader2, Zap, RotateCcw, PencilLine, GripVertical } from 'lucide-react'

interface PluginCodeEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  onSaved?: () => void
}

export function PluginCodeEditor({
  open,
  onOpenChange,
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
  const [editorHeight, setEditorHeight] = useState(420)

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
    if (open && filename) {
      fetchCode()
    }
  }, [open, filename, fetchCode])

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

  const handleEditorResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = editorHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(220, startHeight + deltaY)
      setEditorHeight(newHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [editorHeight])

  const handleAIRevise = async () => {
    if (!extraInstruction.trim() || !isAIReady) return

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

  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v && isDirty && !confirm('有未保存的修改，确定要关闭吗？')) return
      onOpenChange(v)
    }}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={900} storageKey="plugin-code-editor">
        <SheetHeader className="px-6 pt-6 pb-3">
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            {filename}
            {isDirty && <Badge variant="outline" className="text-orange-600 border-orange-300">未保存</Badge>}
          </SheetTitle>
          <SheetDescription>查看和编辑插件源码，保存后需热加载才能生效</SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-[320px] gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>加载中...</span>
            </div>
          ) : error && !code ? (
            <div className="flex items-center justify-center h-[320px] text-destructive">
              {error}
            </div>
          ) : (
            <>
              <div className="relative group" style={{ height: `${editorHeight}px` }}>
                <MonacoEditor
                  value={code}
                  onChange={setCode}
                  language="javascript"
                  height="flex"
                />
                <div
                  className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-border/50 to-transparent"
                  onMouseDown={handleEditorResize}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plugin-editor-extra-instruction">补充需求信息</Label>
                <Textarea
                  id="plugin-editor-extra-instruction"
                  value={extraInstruction}
                  onChange={(e) => setExtraInstruction(e.target.value)}
                  placeholder="例如：补充 onBeforeResponse 对空 referer 的处理；保留现有 manifest 和 hook，不要改插件 id。"
                  className="min-h-[88px]"
                  disabled={revising || saving}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {reviseStatus || '输入补充需求后，AI 会基于当前代码直接更新编辑器内容。'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAIRevise}
                    disabled={!extraInstruction.trim() || !isAIReady || revising || saving}
                  >
                    {revising ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        AI 更新中...
                      </>
                    ) : (
                      <>
                        <PencilLine className="h-4 w-4 mr-1" />
                        根据补充需求更新代码
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
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
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (isDirty && !confirm('有未保存的修改，确定要关闭吗？')) return
                onOpenChange(false)
              }}
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
      </SheetContent>
    </Sheet>
  )
}

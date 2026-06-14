import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { 
  Wand2, 
  Save, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Code,
  Sparkles,
  Copy,
  Check
} from 'lucide-react'
import { getAIConfig, isAIConfigValid } from '@/lib/ai-config-store'

interface PluginGeneratorProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  embedded?: boolean
  onPluginSaved?: () => void
}

interface GeneratedPluginManifest {
  id: string
  name: string
  version: string
  hooks: string[]
  permissions: string[]
}

export function PluginGenerator({ open = false, onOpenChange, embedded = false, onPluginSaved }: PluginGeneratorProps) {
  const [pluginName, setPluginName] = useState('')
  const [pluginDescription, setPluginDescription] = useState('')
  const [hooks, setHooks] = useState('')
  const [permissions, setPermissions] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatedCode, setGeneratedCode] = useState('')
  const [generatedFilename, setGeneratedFilename] = useState('')
  const [generatedManifest, setGeneratedManifest] = useState<GeneratedPluginManifest | null>(null)
  const [statusType, setStatusType] = useState<'success' | 'error' | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [codeLength, setCodeLength] = useState(0)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [saved, setSaved] = useState(false)
  const [reloading, setReloading] = useState(false)

  const aiConfig = getAIConfig()
  const isAIReady = isAIConfigValid(aiConfig)

  const handleGenerate = async () => {
    if (!pluginName.trim() || !pluginDescription.trim()) {
      setStatusType('error')
      setStatusMessage('请填写插件名称和描述')
      return
    }

    if (!isAIReady) {
      setStatusType('error')
      setStatusMessage('AI 配置未完成，请先配置 AI 服务')
      return
    }

    setGenerating(true)
    setStatusType(null)
    setStatusMessage('正在连接 AI 服务...')
    setGeneratedCode('')
    setCodeLength(0)
    setGenerationProgress(0)

    const startTime = Date.now()
    let chunkCount = 0

    try {
      const requirement = {
        name: pluginName,
        description: pluginDescription,
        hooks: hooks.split(',').map(h => h.trim()).filter(Boolean),
        permissions: permissions.split(',').map(p => p.trim()).filter(Boolean),
      }

      // 使用 fetch 手动处理 SSE
      const response = await fetch('/api/plugins/generate-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requirement,
          aiConfig: {
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            baseUrl: aiConfig.baseUrl,
            model: aiConfig.model,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('无法读取响应流')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            // const eventType = line.slice(6).trim()
            continue
          }

          if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            
            try {
              const parsed = JSON.parse(data)

              if (parsed.status === 'generating') {
                setStatusMessage('AI 正在生成代码...')
                setGenerationProgress(10)
              } else if (parsed.chunk) {
                chunkCount++
                const accumulated = parsed.accumulated || parsed.chunk
                setGeneratedCode(accumulated)
                setCodeLength(accumulated.length)
                
                // 更新进度 (10-90%)
                const progress = Math.min(90, 10 + (chunkCount * 2))
                setGenerationProgress(progress)
                
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
                setStatusMessage(`生成中... (${accumulated.length} 字符, ${elapsed}s)`)
              } else if (parsed.status === 'success') {
                setGeneratedCode(parsed.plugin.code)
                setGeneratedFilename(parsed.plugin.filename)
                setGeneratedManifest(parsed.plugin.manifest)
                setCodeLength(parsed.plugin.code.length)
                setGenerationProgress(100)
                setStatusType('success')
                
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
                setStatusMessage(`插件代码生成成功！(${parsed.plugin.code.length} 字符, ${totalTime}s)`)
              } else if (parsed.error) {
                throw new Error(parsed.error)
              }
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
                throw e
              }
            }
          }
        }
      }
    } catch (error) {
      setStatusType('error')
      setStatusMessage(error instanceof Error ? error.message : '生成失败')
      setGenerationProgress(0)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!generatedCode || !generatedFilename) {
      setStatusType('error')
      setStatusMessage('没有可保存的插件代码')
      return
    }

    setSaving(true)
    setStatusType(null)
    setStatusMessage('正在保存插件...')

    try {
      const response = await fetch('/api/plugins/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: generatedFilename,
          code: generatedCode,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '保存失败')
      }

      await response.json()
      
      setStatusType('success')
      setStatusMessage(`插件已保存！现在可以热加载并测试。`)
      setSaved(true)
      window.dispatchEvent(new CustomEvent('plugins-custom-updated'))
      
      // 通知父组件插件已保存
      if (onPluginSaved) {
        onPluginSaved()
      }
      window.dispatchEvent(new CustomEvent('plugins-custom-updated'))
    } catch (error) {
      setStatusType('error')
      setStatusMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    if (generatedCode) {
      await navigator.clipboard.writeText(generatedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleHotReload = async () => {
    setReloading(true)
    try {
      const response = await fetch('/api/plugins/reload', {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '热加载失败')
      }

      const data = await response.json()
      setStatusType('success')
      setStatusMessage(`成功热加载 ${data.count} 个插件！插件已激活，可以使用了。`)
      
      // 通知父组件更新插件列表
      if (onPluginSaved) {
        onPluginSaved()
      }

      // 3秒后关闭
      setTimeout(() => {
        onOpenChange?.(false)
        resetForm()
      }, 3000)
    } catch (error) {
      setStatusType('error')
      setStatusMessage(error instanceof Error ? error.message : '热加载失败')
    } finally {
      setReloading(false)
    }
  }

  const resetForm = () => {
    setPluginName('')
    setPluginDescription('')
    setHooks('')
    setPermissions('')
    setGeneratedCode('')
    setGeneratedFilename('')
    setGeneratedManifest(null)
    setStatusType(null)
    setStatusMessage('')
    setCopied(false)
    setCodeLength(0)
    setGenerationProgress(0)
    setSaved(false)
    setReloading(false)
  }

  const body = (
    <>
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI 插件生成器
          </SheetTitle>
          <SheetDescription>
            使用 AI 根据插件系统设计和您的需求自动生成自定义插件代码
          </SheetDescription>
        </SheetHeader>
        
        <Separator />
        
        <div className="app-panel-content">
          {!isAIReady && (
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-md p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                AI 功能未配置或未启用，请先在设置中配置 AI 服务
              </p>
            </div>
          )}

          {/* 插件需求输入 */}
          <div className="app-section">
            <div className="app-field-group">
              <Label htmlFor="pluginName">
                插件名称 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pluginName"
                value={pluginName}
                onChange={(e) => setPluginName(e.target.value)}
                placeholder="例如：请求日志分析器"
                disabled={generating || saving}
              />
            </div>

            <div className="app-field-group">
              <Label htmlFor="pluginDescription">
                插件描述 <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="pluginDescription"
                value={pluginDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPluginDescription(e.target.value)}
                placeholder="详细描述插件的功能，例如：分析HTTP请求日志，统计各个API的调用次数、响应时间等信息，并在控制台输出统计报告"
                rows={4}
                disabled={generating || saving}
              />
            </div>

            <div className="app-field-group">
              <Label htmlFor="hooks">
                需要的 Hooks（可选，用逗号分隔）
              </Label>
              <Input
                id="hooks"
                value={hooks}
                onChange={(e) => setHooks(e.target.value)}
                placeholder="例如：onRequestStart, onAfterResponse"
                disabled={generating || saving}
              />
              <p className="text-xs text-muted-foreground">
                可选：onRequestStart, onBeforeProxy, onBeforeResponse, onAfterResponse, onError
              </p>
            </div>

            <div className="app-field-group">
              <Label htmlFor="permissions">
                需要的权限（可选，用逗号分隔）
              </Label>
              <Input
                id="permissions"
                value={permissions}
                onChange={(e) => setPermissions(e.target.value)}
                placeholder="例如：proxy:read, storage:write"
                disabled={generating || saving}
              />
              <p className="text-xs text-muted-foreground">
                可选：proxy:read, proxy:write, response:shortcircuit, storage:read, storage:write
              </p>
            </div>
          </div>

          {/* 实时生成进度 */}
          {generating && generationProgress > 0 && (
            <div className="app-field-group">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">生成进度</span>
                <span className="font-medium">{generationProgress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300 ease-out"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* 生成的代码 */}
          {(generatedCode || generating) && (
            <div className="app-field-group">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  {generating ? '正在生成插件代码' : '生成的插件代码'}
                </Label>
                <div className="flex items-center gap-2">
                  {codeLength > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {codeLength} 字符
                    </span>
                  )}
                  {!generating && generatedCode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                      className="h-8"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          已复制
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          复制
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <div className="bg-muted rounded-md p-4 max-h-[400px] overflow-auto relative">
                {generating && (
                  <div className="absolute top-2 right-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                  {generatedCode || '等待 AI 响应...'}
                </pre>
              </div>
              
              {generatedManifest && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-3 space-y-2">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    插件信息
                  </p>
                  <div className="text-xs space-y-1 text-blue-700 dark:text-blue-300">
                    <div><strong>ID:</strong> {generatedManifest.id}</div>
                    <div><strong>名称:</strong> {generatedManifest.name}</div>
                    <div><strong>版本:</strong> {generatedManifest.version}</div>
                    <div className="flex items-center gap-2">
                      <strong>Hooks:</strong>
                      <div className="flex flex-wrap gap-1">
                        {generatedManifest.hooks.map((hook: string) => (
                          <Badge key={hook} variant="secondary" className="text-xs">
                            {hook}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <strong>权限:</strong>
                      <div className="flex flex-wrap gap-1">
                        {generatedManifest.permissions.map((perm: string) => (
                          <Badge key={perm} variant="outline" className="text-xs">
                            {perm}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 状态消息 */}
          {statusMessage && (
            <div className={`flex items-start gap-2 p-3 rounded-md border ${
              statusType === 'success' 
                ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                : statusType === 'error'
                ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
            }`}>
              {statusType === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />}
              {statusType === 'error' && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />}
              {generating && <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 animate-spin" />}
              <span className={`text-xs flex-1 ${
                statusType === 'success' 
                  ? 'text-green-700 dark:text-green-300'
                  : statusType === 'error'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-blue-700 dark:text-blue-300'
              }`}>
                {statusMessage}
              </span>
            </div>
          )}
        </div>

        <Separator />
        
        <div className="px-6 py-4 flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange?.(false)
              resetForm()
            }}
            disabled={generating || saving || reloading}
          >
            {saved ? '完成' : '取消'}
          </Button>
          <div className="flex gap-2">
            {!generatedCode ? (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={!isAIReady || generating || saving || !pluginName.trim() || !pluginDescription.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-1" />
                    生成插件
                  </>
                )}
              </Button>
            ) : !saved ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGeneratedCode('')
                    setGeneratedFilename('')
                    setGeneratedManifest(null)
                    setStatusType(null)
                    setStatusMessage('')
                  }}
                  disabled={generating || saving}
                >
                  重新生成
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      保存插件
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={handleHotReload}
                disabled={reloading}
                className="bg-green-600 hover:bg-green-700"
              >
                {reloading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    加载中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" />
                    热加载并测试
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
    </>
  )

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{body}</div>
  }

  return (
    <Sheet open={open} onOpenChange={(newOpen) => {
      onOpenChange?.(newOpen)
      if (!newOpen) {
        resetForm()
      }
    }}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={900} storageKey="plugin-generator">
        {body}
      </SheetContent>
    </Sheet>
  )
}

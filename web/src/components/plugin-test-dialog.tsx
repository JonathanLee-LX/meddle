import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  AlertCircle,
  Globe,
  ArrowRight,
  FileText,
  Wand2,
  RefreshCw,
  Code2,
} from 'lucide-react'
import { BodyDiffView, type DiffViewMode } from './body-diff-view'
import { getAIConfig, getActiveModel, isAIConfigValid } from '@/lib/ai-config-store'

type HeaderDiffStatus = 'unchanged' | 'changed' | 'added' | 'removed'

interface HeaderDiffRow {
  key: string
  displayKey: string
  originalValue: string
  modifiedValue: string
  status: HeaderDiffStatus
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Map<string, { displayKey: string; value: string }> {
  const map = new Map<string, { displayKey: string; value: string }>()
  if (!headers || typeof headers !== 'object') return map

  Object.entries(headers).forEach(([key, value]) => {
    map.set(key.toLowerCase(), {
      displayKey: key,
      value: value != null ? String(value) : '',
    })
  })

  return map
}

function buildHeaderDiffRows(
  originalHeaders: Record<string, unknown> | undefined,
  modifiedHeaders: Record<string, unknown> | undefined,
): HeaderDiffRow[] {
  const originalMap = normalizeHeaders(originalHeaders)
  const modifiedMap = normalizeHeaders(modifiedHeaders)
  const keys = Array.from(new Set([...originalMap.keys(), ...modifiedMap.keys()])).sort()

  return keys.map((key) => {
    const originalEntry = originalMap.get(key)
    const modifiedEntry = modifiedMap.get(key)
    const originalValue = originalEntry?.value ?? ''
    const modifiedValue = modifiedEntry?.value ?? ''

    let status: HeaderDiffStatus = 'unchanged'
    if (!originalEntry && modifiedEntry) status = 'added'
    else if (originalEntry && !modifiedEntry) status = 'removed'
    else if (originalValue !== modifiedValue) status = 'changed'

    return {
      key,
      displayKey: modifiedEntry?.displayKey ?? originalEntry?.displayKey ?? key,
      originalValue,
      modifiedValue,
      status,
    }
  })
}

function getHeaderCellClassName(status: HeaderDiffStatus, column: 'original' | 'modified'): string {
  const base = 'rounded-md border px-2 py-1.5'
  if (status === 'unchanged') return `${base} border-transparent`
  if (status === 'changed') return `${base} border-orange-300 bg-orange-500/10`
  if (status === 'added') return column === 'modified'
    ? `${base} border-green-300 bg-green-500/10`
    : `${base} border-transparent opacity-50`
  if (status === 'removed') return column === 'original'
    ? `${base} border-red-300 bg-red-500/10`
    : `${base} border-transparent opacity-50`
  return base
}

function HeaderDiffView({
  original,
  modified,
  mode = 'split',
}: {
  original: Record<string, unknown> | undefined
  modified: Record<string, unknown> | undefined
  mode?: DiffViewMode
}) {
  const rows = buildHeaderDiffRows(original, modified)

  if (mode === 'inline') {
    return (
      <div className="bg-muted/50 rounded-md p-2 text-xs font-mono max-h-[220px] overflow-auto space-y-1">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`rounded-md border px-2 py-1.5 ${
              row.status === 'unchanged'
                ? 'border-transparent'
                : row.status === 'changed'
                  ? 'border-orange-300 bg-orange-500/10'
                  : row.status === 'added'
                    ? 'border-green-300 bg-green-500/10'
                    : 'border-red-300 bg-red-500/10'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{row.displayKey}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                {row.status === 'unchanged'
                  ? '未变'
                  : row.status === 'changed'
                    ? '修改'
                    : row.status === 'added'
                      ? '新增'
                      : '删除'}
              </Badge>
            </div>
            {row.status === 'changed' && (
              <div className="mt-1 space-y-1">
                <div className="text-red-700 dark:text-red-300">
                  <span className="mr-1">-</span>
                  {row.originalValue || <span className="text-muted-foreground italic">(无)</span>}
                </div>
                <div className="text-green-700 dark:text-green-300">
                  <span className="mr-1">+</span>
                  {row.modifiedValue || <span className="text-muted-foreground italic">(无)</span>}
                </div>
              </div>
            )}
            {row.status === 'added' && (
              <div className="mt-1 text-green-700 dark:text-green-300">
                <span className="mr-1">+</span>
                {row.modifiedValue || <span className="text-muted-foreground italic">(无)</span>}
              </div>
            )}
            {row.status === 'removed' && (
              <div className="mt-1 text-red-700 dark:text-red-300">
                <span className="mr-1">-</span>
                {row.originalValue || <span className="text-muted-foreground italic">(无)</span>}
              </div>
            )}
            {row.status === 'unchanged' && (
              <div className="mt-1">
                {row.modifiedValue || row.originalValue || <span className="text-muted-foreground italic">(无)</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <div className="text-[10px] text-muted-foreground mb-0.5">原始</div>
        <div className="bg-muted/50 rounded-md p-2 text-xs font-mono max-h-[220px] overflow-auto space-y-1">
          {rows.map((row) => (
            <div key={`original-${row.key}`} className={getHeaderCellClassName(row.status, 'original')}>
              <span className="text-muted-foreground">{row.displayKey}:</span>{' '}
              {row.originalValue || <span className="text-muted-foreground italic">(无)</span>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground mb-0.5">修改后</div>
        <div className="bg-muted/50 rounded-md p-2 text-xs font-mono max-h-[220px] overflow-auto space-y-1">
          {rows.map((row) => (
            <div key={`modified-${row.key}`} className={getHeaderCellClassName(row.status, 'modified')}>
              <span className="text-muted-foreground">{row.displayKey}:</span>{' '}
              {row.modifiedValue || <span className="text-muted-foreground italic">(无)</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface PluginTestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pluginId: string
  pluginName: string
  hooks: string[]
  onPluginFixed?: () => void
}

interface TestErrorItem {
  hookName: string
  message: string
  stack?: string
}

export function PluginTestDialog({
  open,
  onOpenChange,
  pluginId,
  pluginName,
  hooks,
  onPluginFixed,
}: PluginTestDialogProps) {
  const [testing, setTesting] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [testUrl, setTestUrl] = useState('https://365.wps.cn/home')
  const [testMethod, setTestMethod] = useState('GET')
  const [testMode, setTestMode] = useState<'standalone' | 'integrated'>('standalone')
  const [testResults, setTestResults] = useState<any>(null)
  const [headerDiffMode, setHeaderDiffMode] = useState<DiffViewMode>('split')
  const [bodyDiffMode, setBodyDiffMode] = useState<DiffViewMode>('inline')
  const [fixResult, setFixResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null)

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
  const customFilename = pluginId.startsWith('local.') ? `${pluginId.slice('local.'.length)}.js` : ''

  const testErrors = useMemo(() => {
    const errors: TestErrorItem[] = []
    if (testResults?.error) {
      errors.push({ hookName: 'test', message: testResults.error })
    }
    Object.entries(testResults?.hookResults || {}).forEach(([hookName, result]: [string, any]) => {
      if (result?.status === 'error') {
        errors.push({
          hookName,
          message: result.error || '未知错误',
          stack: result.stack,
        })
      }
    })
    if (testResults?.realRequest?.fetchError) {
      errors.push({
        hookName: 'fetch',
        message: testResults.realRequest.fetchError,
      })
    }
    return errors
  }, [testResults])

  const hasFixableErrors = testErrors.length > 0 && !!customFilename

  const handleTest = async () => {
    setTesting(true)
    setTestResults(null)
    setFixResult(null)

    try {
      const response = await fetch('/api/plugins/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginId,
          url: testUrl,
          method: testMethod,
          integrated: testMode === 'integrated',
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '测试失败')
      }

      const data = await response.json()
      setTestResults(data.results)
    } catch (error) {
      setTestResults({
        error: error instanceof Error ? error.message : '测试失败',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleAIFix = async () => {
    if (!hasFixableErrors || !isAIReady) return

    setFixing(true)
    setFixResult(null)
    try {
      const codeRes = await fetch(`/api/plugins/custom/${encodeURIComponent(customFilename)}/code`)
      if (!codeRes.ok) {
        const error = await codeRes.json()
        throw new Error(error.error || '读取插件源码失败')
      }
      const codeData = await codeRes.json()

      const errorSummary = testErrors
        .map((item) => `Hook: ${item.hookName}\nError: ${item.message}${item.stack ? `\nStack:\n${item.stack}` : ''}`)
        .join('\n\n---\n\n')

      const fixRes = await fetch('/api/plugins/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalCode: codeData.code,
          testError: errorSummary,
          requirement: {
            name: pluginName,
            description: `修复插件 ${pluginName} 在测试中的报错，并保持现有 hooks 行为正确。Hooks: ${hooks.join(', ')}`,
            hooks,
          },
          aiConfig: effectiveAIConfig,
        }),
      })

      if (!fixRes.ok) {
        const error = await fixRes.json()
        throw new Error(error.error || 'AI 修复失败')
      }
      const fixData = await fixRes.json()
      const fixedCode = fixData.fixedCode
      if (!fixedCode || typeof fixedCode !== 'string') {
        throw new Error('AI 未返回有效代码')
      }

      const saveRes = await fetch(`/api/plugins/custom/${encodeURIComponent(customFilename)}/code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fixedCode }),
      })
      if (!saveRes.ok) {
        const error = await saveRes.json()
        throw new Error(error.error || '保存修复后的代码失败')
      }

      const reloadRes = await fetch('/api/plugins/reload', { method: 'POST' })
      if (!reloadRes.ok) {
        const error = await reloadRes.json().catch(() => ({ error: '热加载失败' }))
        throw new Error(error.error || '热加载失败')
      }

      setFixResult({ status: 'success', message: 'AI 已修复插件代码并完成热加载。请重新测试验证结果。' })
      onPluginFixed?.()
      await handleTest()
    } catch (error) {
      setFixResult({
        status: 'error',
        message: error instanceof Error ? error.message : 'AI 修复失败',
      })
    } finally {
      setFixing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={900} storageKey="plugin-test">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            测试插件: {pluginName}
          </SheetTitle>
          <SheetDescription>
            发起真实 HTTP 请求，在请求/响应过程中运行插件代码
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {/* 测试配置 */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="testUrl">请求 URL</Label>
              <Input
                id="testUrl"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder="https://example.com/page"
                disabled={testing}
              />
            </div>

            <div className="space-y-2">
              <Label>HTTP 方法</Label>
              <div className="flex gap-2">
                {['GET', 'POST', 'PUT', 'DELETE'].map((method) => (
                  <Button
                    key={method}
                    type="button"
                    variant={testMethod === method ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTestMethod(method)}
                    disabled={testing}
                  >
                    {method}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>测试模式</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={testMode === 'standalone' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTestMode('standalone')}
                  disabled={testing}
                  title="直接请求 URL，不走路由与 Mock，便于排查插件自身逻辑"
                >
                  单独测试
                </Button>
                <Button
                  type="button"
                  variant={testMode === 'integrated' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTestMode('integrated')}
                  disabled={testing}
                  title="与真实代理一致：先路由解析、Mock 匹配，再请求，便于排查整体链路"
                >
                  集成测试
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {testMode === 'standalone'
                  ? '直接请求上述 URL，不经过路由规则和 Mock，适合验证插件逻辑。'
                  : '先按路由规则解析目标、匹配 Mock，再请求，与经代理的真实请求一致，适合排查链路问题。'}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-3">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <strong>测试流程:</strong> 发起真实请求 → 获取服务器响应 → 运行插件 Hook（{hooks.join(', ')}）→ 展示对比结果
              </p>
            </div>
          </div>

          {/* 测试结果 */}
          {testResults && (
            <div className="space-y-3">
              <Separator />

              {testResults.error ? (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                    <span className="text-sm text-red-700 dark:text-red-300">{testResults.error}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 items-center rounded-md border bg-muted/20 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Header 对比</span>
                      <Tabs value={headerDiffMode} onValueChange={(value) => setHeaderDiffMode(value as DiffViewMode)}>
                        <TabsList className="h-7">
                          <TabsTrigger value="split" className="px-2 text-xs">分栏</TabsTrigger>
                          <TabsTrigger value="inline" className="px-2 text-xs">行内</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Body 对比</span>
                      <Tabs value={bodyDiffMode} onValueChange={(value) => setBodyDiffMode(value as DiffViewMode)}>
                        <TabsList className="h-7">
                          <TabsTrigger value="inline" className="px-2 text-xs">行内</TabsTrigger>
                          <TabsTrigger value="split" className="px-2 text-xs">分栏</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  </div>

                  {/* 真实请求信息 */}
                  {testResults.realRequest && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        真实请求
                        {testResults.realRequest.testMode && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {testResults.realRequest.testMode === 'integrated' ? '集成测试' : '单独测试'}
                          </Badge>
                        )}
                      </h3>
                      <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1">
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs">{testResults.realRequest.method}</Badge>
                          <span className="font-mono break-all">{testResults.realRequest.url}</span>
                        </div>
                        {testResults.realRequest.fetchError ? (
                          <div className="text-red-600 flex items-center gap-1 mt-1">
                            <XCircle className="h-3 w-3" />
                            请求失败: {testResults.realRequest.fetchError}
                          </div>
                        ) : (
                          <div className="text-muted-foreground space-y-0.5">
                            <div>
                              耗时: {testResults.realRequest.fetchDuration}ms
                              {testResults.originalResponse && (
                                <> · 状态码: <Badge variant="outline" className="text-xs">{testResults.originalResponse.statusCode}</Badge> · 响应大小: {testResults.originalResponse.bodyLength} 字符</>
                              )}
                            </div>
                            {(testResults.realRequest.targetResolved || testResults.realRequest.usedMock) && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {testResults.realRequest.targetResolved && (
                                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">路由已改写</Badge>
                                )}
                                {testResults.realRequest.usedMock && (
                                  <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">已使用 Mock</Badge>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hook 执行结果 */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Hook 执行结果
                    </h3>
                    {Object.keys(testResults.hookResults || {}).length === 0 ? (
                      <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
                        没有 Hook 被执行
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {Object.entries(testResults.hookResults || {}).map(([hookName, result]: [string, any]) => (
                          <div
                            key={hookName}
                            className={`border rounded-md p-3 ${
                              result.status === 'success'
                                ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                                : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {result.status === 'success' ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-600" />
                                )}
                                <span className="font-medium text-sm">{hookName}</span>
                              </div>
                              {result.duration !== undefined && (
                                <Badge variant="outline" className="text-xs">{result.duration}ms</Badge>
                              )}
                            </div>
                            {result.status === 'error' && (
                              <div className="mt-2 space-y-2">
                                <div className="rounded-md border border-red-200 bg-red-100/60 px-2 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                                  <div className="font-medium mb-1">错误原因</div>
                                  <pre className="font-mono whitespace-pre-wrap break-all">{result.error}</pre>
                                </div>
                                {result.stack && (
                                  <details className="rounded-md border border-red-200 bg-background/60 px-2 py-2 text-xs dark:border-red-900">
                                    <summary className="cursor-pointer text-red-700 dark:text-red-300">查看错误堆栈</summary>
                                    <pre className="font-mono whitespace-pre-wrap break-all mt-2 text-muted-foreground">
                                      {result.stack}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            )}
                            {result.targetChanged && (
                              <div className="text-xs text-blue-700 mt-1 flex items-center gap-1">
                                <ArrowRight className="h-3 w-3" />
                                Target 已修改为: {result.targetChanged}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {testErrors.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-medium flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          错误详情
                        </h3>
                        <div className="flex items-center gap-2">
                          {!isAIReady && (
                            <span className="text-xs text-muted-foreground">AI 未配置，无法自动修复</span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleAIFix}
                            disabled={!hasFixableErrors || !isAIReady || fixing || testing}
                          >
                            {fixing ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                AI 修复中...
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-4 w-4 mr-1" />
                                AI 修复并更新代码
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {testErrors.map((item, index) => (
                          <div key={`${item.hookName}-${index}`} className="rounded-md border border-red-200 bg-red-50/80 p-3 dark:border-red-900 dark:bg-red-950/20">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">{item.hookName}</Badge>
                              <span className="text-xs text-red-700 dark:text-red-300">错误原因</span>
                            </div>
                            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-red-800 dark:text-red-300">
                              {item.message}
                            </pre>
                            {item.stack && (
                              <details className="mt-2 text-xs">
                                <summary className="cursor-pointer text-muted-foreground">查看完整堆栈</summary>
                                <pre className="font-mono whitespace-pre-wrap break-all mt-2 text-muted-foreground">
                                  {item.stack}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                      {fixResult && (
                        <div
                          className={`rounded-md border px-3 py-2 text-sm ${
                            fixResult.status === 'success'
                              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300'
                              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {fixResult.status === 'success' ? (
                              <RefreshCw className="h-4 w-4" />
                            ) : (
                              <Code2 className="h-4 w-4" />
                            )}
                            <span>{fixResult.message}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Request 对比：仅在被修改时显示 */}
                  {(testResults.requestHeadersChanged || testResults.requestBodyChanged) && testResults.originalRequest && testResults.modifiedRequest && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        请求对比（已被插件修改）
                      </h3>
                      {testResults.requestHeadersChanged && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">Request Headers</div>
                          <HeaderDiffView
                            original={testResults.originalRequest.headers}
                            modified={testResults.modifiedRequest.headers}
                            mode={headerDiffMode}
                          />
                        </div>
                      )}
                      {testResults.requestBodyChanged && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">Request Body</div>
                          <BodyDiffView
                            original={testResults.originalRequest.body || ''}
                            modified={testResults.modifiedRequest.body || ''}
                            mode={bodyDiffMode}
                            maxHeight="180px"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Response Headers 对比：仅在被修改时显示 */}
                  {testResults.responseHeadersChanged && testResults.originalResponse?.headers && testResults.modifiedResponse?.headers && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                        Response Headers 对比（已被插件修改）
                      </h3>
                      <HeaderDiffView
                        original={testResults.originalResponse.headers}
                        modified={testResults.modifiedResponse.headers}
                        mode={headerDiffMode}
                      />
                    </div>
                  )}

                  {/* Response Body 对比：Diff 形式，仅在被修改时展示 Diff */}
                  {testResults.modifiedResponse && testResults.originalResponse && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        {testResults.modifiedResponse.bodyChanged ? (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        )}
                        响应 Body
                        {testResults.modifiedResponse.bodyChanged ? (
                          <>
                            <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300">已修改</Badge>
                            <span className="text-[10px] text-muted-foreground">
                              （差异 {testResults.modifiedResponse.bodyLength - testResults.originalResponse.bodyLength > 0 ? '+' : ''}
                              {testResults.modifiedResponse.bodyLength - testResults.originalResponse.bodyLength} 字符）
                            </span>
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">未变化</Badge>
                        )}
                      </h3>
                      {testResults.modifiedResponse.bodyChanged ? (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">
                            绿色=新增行，红色=删除行。仅对比前约 2500 字符以保障性能。
                          </p>
                          <BodyDiffView
                            original={testResults.originalResponse.bodyForDiff ?? testResults.originalResponse.bodyPreview ?? ''}
                            modified={testResults.modifiedResponse.bodyForDiff ?? testResults.modifiedResponse.bodyPreview ?? ''}
                            mode={bodyDiffMode}
                            maxHeight="320px"
                          />
                        </div>
                      ) : (
                        <pre className="bg-muted/50 rounded-md p-2 text-xs font-mono max-h-[200px] overflow-auto whitespace-pre-wrap break-all">
                          {testResults.originalResponse.bodyPreview}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* 短路响应 */}
                  {testResults.shortCircuited && testResults.shortCircuitResponse && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-blue-500" />
                        插件短路了请求（未发起真实请求）
                      </h3>
                      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-3">
                        <div className="text-xs">
                          <div>状态码: {testResults.shortCircuitResponse.statusCode}</div>
                          <pre className="mt-2 font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
                            {testResults.shortCircuitResponse.body}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 插件日志 */}
                  {testResults.logs && testResults.logs.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">插件日志</h3>
                      <div className="bg-muted rounded-md p-3 max-h-[200px] overflow-auto">
                        <div className="space-y-1">
                          {testResults.logs.map((log: any, idx: number) => (
                            <div key={idx} className="text-xs font-mono">
                              <span
                                className={`inline-block w-12 ${
                                  log.level === 'error'
                                    ? 'text-red-600'
                                    : log.level === 'warn'
                                      ? 'text-yellow-600'
                                      : log.level === 'info'
                                        ? 'text-blue-600'
                                        : 'text-muted-foreground'
                                }`}
                              >
                                [{log.level}]
                              </span>
                              <span className="text-foreground">{log.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <Separator />

        <div className="px-6 py-4 flex justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={testing}>
            关闭
          </Button>
          <Button size="sm" onClick={handleTest} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                请求中...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-1" />
                发起测试请求
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Settings,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Monitor,
  Moon,
  Sun,
  FileText,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  Stethoscope,
  AlertCircle,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import {
  getAIConfig,
  saveAIConfig,
  resetAIConfig,
  isAIConfigValid,
  getDefaultValues,
  addModel,
  deleteModel,
  setActiveModel,
  type AIConfig,
  type AIModel,
} from '@/lib/ai-config-store'
import { useTheme } from '@/components/theme-provider'
import { getCachedSettings, loadSettings, updateSettings, type AccentColor } from '@/lib/settings-store'
import { SaveButton } from '@/components/save-shortcut/save-button'
import { SAVE_SHORTCUT_PRIORITY } from '@/components/save-shortcut/save-shortcut-context'
import { useSaveShortcut } from '@/components/save-shortcut/use-save-shortcut'
import { toast } from '@/components/ui/toast'

interface SettingsPanelProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  embedded?: boolean
}

interface ConfigDiagnosticDetails {
  enabledFiles?: number
  enabled?: number
  rules?: number
  size?: number
  total?: number
  totalFiles?: number
  totalRules?: number
}

interface ConfigDiagnosticCheck {
  name: string
  path: string
  details?: ConfigDiagnosticDetails
}

interface ConfigDiagnostics {
  status: 'ok' | 'warning' | 'error'
  checks: ConfigDiagnosticCheck[]
  warnings: string[]
  errors: string[]
}

const zoomScaleOptions = [
  { value: '75', label: '75%', scale: 0.75 },
  { value: '90', label: '90%', scale: 0.9 },
  { value: '100', label: '100%', scale: 1 },
  { value: '110', label: '110%', scale: 1.1 },
  { value: '125', label: '125%', scale: 1.25 },
  { value: '150', label: '150%', scale: 1.5 },
]

const accentColorOptions: Array<{ value: AccentColor; label: string; color: string }> = [
  { value: 'auto', label: '自动', color: 'linear-gradient(135deg, oklch(0.623 0.214 259.815), oklch(0.606 0.25 292.717))' },
  { value: 'neutral', label: '中性', color: 'oklch(0.556 0 0)' },
  { value: 'blue', label: '蓝色', color: 'oklch(0.623 0.214 259.815)' },
  { value: 'violet', label: '紫色', color: 'oklch(0.606 0.25 292.717)' },
  { value: 'green', label: '绿色', color: 'oklch(0.627 0.194 149.214)' },
  { value: 'orange', label: '橙色', color: 'oklch(0.646 0.222 41.116)' },
  { value: 'rose', label: '玫红', color: 'oklch(0.645 0.246 16.439)' },
]

const settingsContentClassName = 'app-panel-content mt-0'
const settingsGroupClassName = 'app-field-group'
const settingsSectionClassName = 'app-section'
type SettingsTab = 'preferences' | 'config' | 'clients' | 'ai'

const normalizeZoomScale = (value?: string) => {
  if (!value) return '100'

  const legacyFontSizeMap: Record<string, string> = {
    small: '90',
    medium: '100',
    large: '110',
  }

  if (value in legacyFontSizeMap) return legacyFontSizeMap[value]

  return zoomScaleOptions.some((option) => option.value === value) ? value : '100'
}

export function SettingsPanel({ open = false, onOpenChange, embedded = false }: SettingsPanelProps) {
  const { theme, accentColor, setTheme, setAccentColor, setZoom } = useTheme()
  const [activeTab, setActiveTab] = useState<SettingsTab>('preferences')

  // AI 配置状态
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => getAIConfig())
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<'success' | 'error' | null>(null)
  const [aiTestMessage, setAiTestMessage] = useState('')

  // 多模型配置状态
  const [newModelForm, setNewModelForm] = useState<Partial<AIModel> | null>(null)

  // 配置文件状态
  const [mocksFilePath, setMocksFilePath] = useState('')
  const [ruleFiles, setRuleFiles] = useState<Array<{ name: string; enabled: boolean; ruleCount: number }>>([])
  const [clientAliases, setClientAliases] = useState<Record<string, string>>({})
  const [newClientIp, setNewClientIp] = useState('')
  const [newClientName, setNewClientName] = useState('')

  // 配置诊断状态
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnostics | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)

  // 缩放比例偏好
  const [zoomScale, setZoomScale] = useState<string>(() => normalizeZoomScale(getCachedSettings().fontSize))
  const [zoomReady, setZoomReady] = useState(false)

  // 初始化缩放比例
  useEffect(() => {
    loadSettings()
      .then((settings) => {
        const saved = normalizeZoomScale(settings.fontSize)
        setZoomScale(saved)
        setZoom(parseInt(saved, 10) / 100)
        setZoomReady(true)
      })
      .catch(() => {
        setZoomReady(true)
      })
  }, [setZoom])

  useEffect(() => {
    if (!zoomReady) return

    const normalizedScale = normalizeZoomScale(zoomScale)
    setZoom(parseInt(normalizedScale, 10) / 100)
    updateSettings({ fontSize: normalizedScale }).catch(console.error)
  }, [setZoom, zoomReady, zoomScale])

  useEffect(() => {
    if (open || embedded) {
      loadSettings()
        .then((settings) => {
          setAiConfig(settings.aiConfig)
          setMocksFilePath(settings.mocksFilePath || '')
          setClientAliases(settings.clientAliases || {})
        })
        .catch(() => {
          setAiConfig(getAIConfig())
        })
      setAiTestResult(null)
      setAiTestMessage('')
      fetch('/api/rule-files')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setRuleFiles(data)
        })
        .catch(() => {})
    }
  }, [open, embedded])

  // AI 相关处理函数
  const handleProviderChange = (provider: 'openai' | 'anthropic') => {
    const defaults = getDefaultValues(provider)
    setAiConfig({
      ...aiConfig,
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    })
  }

  const handleAiSave = async () => {
    setSaving(true)
    try {
      // 保存到文件系统
      await updateSettings({ aiConfig })

      // 同时保存到 localStorage 作为备份
      saveAIConfig(aiConfig)

      setAiTestResult('success')
      setAiTestMessage('AI 配置保存成功')
      toast.success('AI 配置保存成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setAiTestResult('error')
      setAiTestMessage(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleAiReset = () => {
    resetAIConfig()
    setAiConfig(getAIConfig())
    setAiTestResult(null)
    setAiTestMessage('')
  }

  const handleAiTest = async () => {
    if (!isAIConfigValid(aiConfig)) {
      setAiTestResult('error')
      setAiTestMessage('请填写完整的配置信息')
      return
    }

    setSaving(true)
    setAiTestResult(null)
    setAiTestMessage('测试中...')

    try {
      const url = aiConfig.baseUrl
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      let body: Record<string, unknown>

      if (aiConfig.provider === 'anthropic') {
        headers['x-api-key'] = aiConfig.apiKey
        headers['anthropic-version'] = '2023-06-01'
        body = {
          model: aiConfig.model,
          max_tokens: 100,
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: 'Say "test successful"' }],
          temperature: 0.3,
        }
      } else {
        headers['Authorization'] = `Bearer ${aiConfig.apiKey}`
        body = {
          model: aiConfig.model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "test successful"' },
          ],
          temperature: 0.3,
          max_tokens: 100,
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API错误 (${response.status}): ${errorText}`)
      }

      const data = await response.json()

      if (aiConfig.provider === 'anthropic') {
        if (!data.content?.[0]?.text) {
          throw new Error('API响应格式不正确')
        }
      } else {
        if (!data.choices?.[0]?.message?.content) {
          throw new Error('API响应格式不正确')
        }
      }

      setAiTestResult('success')
      setAiTestMessage('连接测试成功! API配置正常')
    } catch (error) {
      setAiTestResult('error')
      setAiTestMessage(error instanceof Error ? error.message : '测试失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/refresh-config', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setAiTestResult('success')
        setAiTestMessage(data.message || '配置已刷新')
        setTimeout(() => {
          setAiTestResult(null)
          setAiTestMessage('')
        }, 2000)
      } else {
        const data = await res.json()
        setAiTestResult('error')
        setAiTestMessage(data.error || '刷新配置失败')
        setTimeout(() => {
          setAiTestResult(null)
          setAiTestMessage('')
        }, 2000)
      }
    } catch (error) {
      console.error('刷新配置失败:', error)
      setAiTestResult('error')
      setAiTestMessage('刷新配置失败')
      setTimeout(() => {
        setAiTestResult(null)
        setAiTestMessage('')
      }, 2000)
    }
  }, [])

  const handleDiagnose = useCallback(async () => {
    setDiagnosing(true)
    setDiagnostics(null)
    try {
      const res = await fetch('/api/config-doctor')
      if (res.ok) {
        const data = await res.json()
        setDiagnostics(data)
      } else {
        setAiTestResult('error')
        setAiTestMessage('诊断失败')
        setTimeout(() => {
          setAiTestResult(null)
          setAiTestMessage('')
        }, 2000)
      }
    } catch (error) {
      console.error('诊断失败:', error)
      setAiTestResult('error')
      setAiTestMessage('诊断失败')
      setTimeout(() => {
        setAiTestResult(null)
        setAiTestMessage('')
      }, 2000)
    } finally {
      setDiagnosing(false)
    }
  }, [])

  const handleAddClientAlias = () => {
    const ip = newClientIp.trim()
    const name = newClientName.trim()
    if (!ip || !name) return
    setClientAliases((current) => ({ ...current, [ip]: name }))
    setNewClientIp('')
    setNewClientName('')
  }

  const handleSaveClientAliases = async () => {
    setSaving(true)
    try {
      await updateSettings({ clientAliases })
      setAiTestResult('success')
      setAiTestMessage('客户端名称已保存，新请求立即生效')
      toast.success('客户端名称保存成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setAiTestResult('error')
      setAiTestMessage(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveMocksFilePath = async () => {
    setSaving(true)
    try {
      await updateSettings({ mocksFilePath })
      setAiTestResult('success')
      setAiTestMessage('Mock 文件路径已更新，刷新页面后生效')
      toast.success('Mock 文件路径保存成功')
      setTimeout(() => {
        setAiTestResult(null)
        setAiTestMessage('')
      }, 3000)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setAiTestResult('error')
      setAiTestMessage(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleActiveTabSave = () => {
    if (activeTab === 'config') return handleSaveMocksFilePath()
    if (activeTab === 'clients') return handleSaveClientAliases()
    if (activeTab === 'ai') return handleAiSave()
  }

  useSaveShortcut({
    active: (open || embedded) && activeTab !== 'preferences',
    enabled: !saving,
    priority: SAVE_SHORTCUT_PRIORITY.panel,
    onSave: handleActiveTabSave,
  })

  const body = (
    <>
      {!embedded && (
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            系统设置
          </SheetTitle>
          <SheetDescription>管理系统偏好、配置和 AI 功能</SheetDescription>
        </SheetHeader>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SettingsTab)}
        orientation="vertical"
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList
          aria-label="设置分类"
          className="h-full w-14 shrink-0 self-stretch justify-start gap-1 rounded-none border-r bg-muted/25 p-2 group-data-[orientation=vertical]/tabs:!h-full sm:w-44 sm:p-3"
        >
          <TabsTrigger value="preferences" className="h-9 w-full flex-none justify-start px-2.5 sm:px-3">
            <Settings />
            <span className="hidden sm:inline">偏好设置</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="h-9 w-full flex-none justify-start px-2.5 sm:px-3">
            <FileText />
            <span className="hidden sm:inline">配置文件</span>
          </TabsTrigger>
          <TabsTrigger value="clients" className="h-9 w-full flex-none justify-start px-2.5 sm:px-3">
            <Smartphone />
            <span className="hidden sm:inline">客户端</span>
          </TabsTrigger>
          <TabsTrigger value="ai" className="h-9 w-full flex-none justify-start px-2.5 sm:px-3">
            <Sparkles />
            <span className="hidden sm:inline">AI 配置</span>
          </TabsTrigger>
        </TabsList>

        {/* 偏好设置 */}
        <TabsContent value="preferences" className={settingsContentClassName}>
          {/* 主题 */}
          <div className={settingsGroupClassName}>
            <Label className="text-sm">主题</Label>
            <Select value={theme} onValueChange={(v: string) => setTheme(v as 'light' | 'dark' | 'system')}>
              <SelectTrigger>
                <SelectValue placeholder="选择主题" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="system">
                    <div className="flex items-center gap-2">
                      <Monitor className="size-4" />
                      跟随系统
                    </div>
                  </SelectItem>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2">
                      <Sun className="size-4" />
                      浅色模式
                    </div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2">
                      <Moon className="size-4" />
                      深色模式
                    </div>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">强调色</Label>
              <p className="text-xs text-muted-foreground">统一按钮、状态、选中项和焦点样式。自动模式会根据明暗主题选择合适的颜色。</p>
            </div>
            <ToggleGroup
              type="single"
              value={accentColor}
              onValueChange={(value) => {
                if (value) setAccentColor(value as AccentColor)
              }}
              variant="outline"
              spacing={1}
              className="flex-wrap justify-start"
              aria-label="强调色"
            >
              {accentColorOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                  {option.value === 'auto' ? (
                    <Sparkles data-icon="inline-start" />
                  ) : (
                    <span className="size-3 rounded-full border border-foreground/10" style={{ background: option.color }} />
                  )}
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* 缩放比例 */}
          <div className={settingsGroupClassName}>
            <Label className="text-sm">缩放比例</Label>
            <Select value={zoomScale} onValueChange={setZoomScale}>
              <SelectTrigger>
                <SelectValue placeholder="选择缩放比例" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {zoomScaleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className={settingsGroupClassName}>
            <h3 className="text-sm font-medium">关于</h3>
            <p className="text-xs text-muted-foreground">Meddle - HTTP 调试代理工具</p>
            <p className="text-xs text-muted-foreground">版本: 1.0.0</p>
          </div>
        </TabsContent>

        {/* 配置文件 */}
        <TabsContent value="config" className={settingsContentClassName}>
          {/* 路由规则文件 */}
          <div className={settingsSectionClassName}>
            <Label className="text-sm font-medium">路由规则文件</Label>
            <div className={settingsGroupClassName}>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono truncate flex-1">~/.meddle/route-rules/</span>
              </div>
              {ruleFiles.length > 0 ? (
                <div className="space-y-2">
                  {ruleFiles.map((rf) => (
                    <div key={rf.name} className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm">
                      <Badge variant={rf.enabled ? 'default' : 'secondary'} className="text-[10px]">
                        {rf.enabled ? '已启用' : '未启用'}
                      </Badge>
                      <span className="flex-1 truncate text-xs">{rf.name}.txt</span>
                      <span className="text-xs text-muted-foreground">{rf.ruleCount} 条规则</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无规则文件</p>
              )}
              <p className="text-xs text-muted-foreground">规则文件存放于 ~/.meddle/route-rules/ 目录，纯文本格式。在"路由规则"页面管理。</p>
            </div>
          </div>

          <Separator />

          {/* Mock 规则文件 */}
          <div className={settingsSectionClassName}>
            <Label className="text-sm font-medium">Mock 规则文件</Label>
            <div className={settingsGroupClassName}>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono truncate flex-1">{mocksFilePath || '默认: ~/.meddle/mocks.json'}</span>
              </div>
              <div className={settingsGroupClassName}>
                <Label htmlFor="mocksPath" className="text-xs text-muted-foreground">
                  自定义 Mock 规则文件路径（留空使用默认）
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="mocksPath"
                    value={mocksFilePath}
                    onChange={(e) => setMocksFilePath(e.target.value)}
                    placeholder="如: /path/to/my-mocks.json"
                    className="flex-1 h-8 text-sm font-mono"
                  />
                  <SaveButton
                    variant="outline"
                    size="sm"
                    onClick={handleSaveMocksFilePath}
                    disabled={saving}
                    className="h-8"
                  >
                    <Save data-icon="inline-start" className="h-3 w-3" />
                    应用
                  </SaveButton>
                </div>
                <p className="text-xs text-muted-foreground">必须是 JSON 格式的 Mock 规则文件</p>
              </div>
            </div>
          </div>

          <Separator />

          <div className={settingsGroupClassName}>
            <h3 className="text-sm font-medium">操作</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefreshConfig}>
                <RefreshCw className="h-4 w-4 mr-1" />
                重新加载配置
              </Button>
              <Button variant="outline" size="sm" onClick={handleDiagnose} disabled={diagnosing}>
                <Stethoscope className="h-4 w-4 mr-1" />
                {diagnosing ? '诊断中...' : '诊断配置'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">点击重新加载可应用修改后的配置文件，点击诊断配置可检查配置有效性</p>
          </div>

          {/* 诊断结果 */}
          {diagnostics && (
            <div className={settingsSectionClassName}>
              <Separator />
              <div>
                <h3 className="mb-4 flex items-center gap-2 text-sm font-medium">
                  <Stethoscope className="h-4 w-4" />
                  诊断结果
                </h3>

                {/* 总体状态 */}
                <div
                  className={`mb-3 p-3 rounded-md border ${
                    diagnostics.status === 'ok'
                      ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                      : diagnostics.status === 'warning'
                        ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900'
                        : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                  }`}
                >
                  {diagnostics.status === 'ok' && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">所有检查通过！配置正常。</span>
                    </div>
                  )}
                  {diagnostics.status === 'warning' && (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">发现 {diagnostics.warnings.length} 个警告</span>
                    </div>
                  )}
                  {diagnostics.status === 'error' && (
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">发现 {diagnostics.errors.length} 个错误</span>
                    </div>
                  )}
                </div>

                {/* 检查项列表 */}
                <div className={settingsGroupClassName}>
                  {diagnostics.checks.map((check, index) => (
                    <div key={index} className="p-2 rounded border bg-card">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{check.name}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{check.path}</div>
                          {check.details && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {check.details.totalFiles !== undefined && `${check.details.enabledFiles}/${check.details.totalFiles} 个文件已启用`}
                              {check.details.totalRules !== undefined && ` · ${check.details.totalRules} 条规则`}
                              {check.details.rules !== undefined && `${check.details.rules} 条规则`}
                              {check.details.total !== undefined && `${check.details.total} 条规则 (${check.details.enabled} 已启用)`}
                              {check.details.size !== undefined && ` · ${check.details.size} bytes`}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 警告列表 */}
                {diagnostics.warnings && diagnostics.warnings.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">警告:</div>
                    {diagnostics.warnings.map((warning: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 错误列表 */}
                {diagnostics.errors && diagnostics.errors.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs font-medium text-red-700 dark:text-red-300">错误:</div>
                    {diagnostics.errors.map((error: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* 客户端名称 */}
        <TabsContent value="clients" className={settingsContentClassName}>
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              远程客户端名称
            </h3>
            <p className="text-xs text-muted-foreground">将日志中的客户端 IP 映射为设备名称。保存后新请求立即生效，无需重启代理。</p>
          </div>

          <div className={settingsGroupClassName}>
            {Object.entries(clientAliases).length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">尚未配置设备名称</div>
            ) : (
              Object.entries(clientAliases).map(([ip, name]) => (
                <div key={ip} className="flex items-center gap-2">
                  <Input value={ip} readOnly className="h-8 flex-1 font-mono text-xs bg-muted/40" aria-label={`客户端 IP ${ip}`} />
                  <Input
                    value={name}
                    onChange={(event) => {
                      const nextName = event.target.value
                      setClientAliases((current) => ({
                        ...current,
                        [ip]: nextName,
                      }))
                    }}
                    className="h-8 flex-1 text-sm"
                    aria-label={`${ip} 的设备名称`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setClientAliases((current) => {
                        const next = { ...current }
                        delete next[ip]
                        return next
                      })
                    }}
                    title="删除设备名称"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className={settingsGroupClassName}>
            <Label className="text-sm">添加设备</Label>
            <div className="flex items-center gap-2">
              <Input
                value={newClientIp}
                onChange={(event) => setNewClientIp(event.target.value)}
                placeholder="客户端 IP，例如 10.13.232.187"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Input
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleAddClientAlias()
                }}
                placeholder="设备名称，例如 iPhone"
                className="h-8 flex-1 text-sm"
              />
              <Button variant="outline" size="sm" className="h-8" onClick={handleAddClientAlias} disabled={!newClientIp.trim() || !newClientName.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                添加
              </Button>
            </div>
          </div>

          <SaveButton onClick={handleSaveClientAliases} disabled={saving}>
            <Save data-icon="inline-start" className="h-4 w-4" />
            {saving ? '保存中...' : '保存客户端名称'}
          </SaveButton>
        </TabsContent>

        {/* AI 配置 */}
        <TabsContent value="ai" className={settingsContentClassName}>
          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Label className="text-sm">启用 AI 功能</Label>
              <p className="text-xs text-muted-foreground">启用智能代码修复功能</p>
            </div>
            <Switch checked={aiConfig.enabled} onCheckedChange={(enabled) => setAiConfig({ ...aiConfig, enabled })} aria-label="启用 AI 功能" />
          </div>

          <Separator />

          {/* 多模型配置 */}
          <div className={settingsSectionClassName}>
            <div className="flex items-center justify-between">
              <Label className="text-sm">AI 模型配置</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewModelForm({
                    name: '',
                    provider: 'openai',
                    apiKey: '',
                    baseUrl: 'https://api.openai.com/v1/chat/completions',
                    model: 'gpt-4o-mini',
                  })
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加模型
              </Button>
            </div>

            {/* 模型列表 */}
            <div className={settingsGroupClassName}>
              {aiConfig.models && aiConfig.models.length > 0 ? (
                aiConfig.models.map((model) => (
                  <div
                    key={model.id}
                    className={`p-3 rounded-md border ${aiConfig.activeModelId === model.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{model.name}</span>
                          {aiConfig.activeModelId === model.id && (
                            <Badge variant="default" className="text-xs">
                              当前使用
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {model.provider === 'openai' ? 'OpenAI' : 'Anthropic'} - {model.model}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {aiConfig.activeModelId !== model.id && (
                          <Button variant="ghost" size="sm" onClick={() => setAiConfig(setActiveModel(aiConfig, model.id))} className="h-7 text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            使用
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setAiConfig(deleteModel(aiConfig, model.id))} className="h-7 w-7 p-0 text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground italic py-4 text-center">暂无模型配置，点击"添加模型"创建</p>
              )}
            </div>

            {/* 新增模型表单 */}
            {newModelForm && (
              <div className="space-y-5 rounded-md border border-primary bg-primary/5 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">新增模型</Label>
                  <Button variant="ghost" size="sm" onClick={() => setNewModelForm(null)} className="h-6 w-6 p-0">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>

                <div className={settingsGroupClassName}>
                  <Label htmlFor="newModelName" className="text-xs">
                    模型名称
                  </Label>
                  <Input
                    id="newModelName"
                    value={newModelForm.name || ''}
                    onChange={(e) => setNewModelForm({ ...newModelForm, name: e.target.value })}
                    placeholder="如：GPT-4o Mini"
                    className="h-8 text-sm"
                  />
                </div>

                <div className={settingsGroupClassName}>
                  <Label className="text-xs">服务商</Label>
                  <ToggleGroup
                    type="single"
                    value={newModelForm.provider}
                    onValueChange={(provider) => {
                      if (provider === 'openai') {
                        const defaults = getDefaultValues('openai')
                        setNewModelForm({
                          ...newModelForm,
                          provider: 'openai',
                          baseUrl: defaults.baseUrl,
                          model: defaults.model,
                        })
                      } else if (provider === 'anthropic') {
                        const defaults = getDefaultValues('anthropic')
                        setNewModelForm({
                          ...newModelForm,
                          provider: 'anthropic',
                          baseUrl: defaults.baseUrl,
                          model: defaults.model,
                        })
                      }
                    }}
                    variant="outline"
                    size="sm"
                    spacing={0}
                  >
                    <ToggleGroupItem value="openai">OpenAI</ToggleGroupItem>
                    <ToggleGroupItem value="anthropic">Anthropic</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className={settingsGroupClassName}>
                  <Label htmlFor="newModelApiKey" className="text-xs">
                    API Key
                  </Label>
                  <Input
                    id="newModelApiKey"
                    type={showApiKey ? 'text' : 'password'}
                    value={newModelForm.apiKey || ''}
                    onChange={(e) =>
                      setNewModelForm({
                        ...newModelForm,
                        apiKey: e.target.value,
                      })
                    }
                    placeholder="输入 API Key"
                    className="h-8 text-sm"
                  />
                </div>

                <div className={settingsGroupClassName}>
                  <Label htmlFor="newModelModel" className="text-xs">
                    模型
                  </Label>
                  <Input
                    id="newModelModel"
                    value={newModelForm.model || ''}
                    onChange={(e) =>
                      setNewModelForm({
                        ...newModelForm,
                        model: e.target.value,
                      })
                    }
                    placeholder="模型名称"
                    className="h-8 text-sm"
                  />
                </div>

                <div className={settingsGroupClassName}>
                  <Label htmlFor="newModelBaseUrl" className="text-xs">
                    API 端点
                  </Label>
                  <Input
                    id="newModelBaseUrl"
                    value={newModelForm.baseUrl || ''}
                    onChange={(e) =>
                      setNewModelForm({
                        ...newModelForm,
                        baseUrl: e.target.value,
                      })
                    }
                    placeholder="API 端点"
                    className="h-8 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setNewModelForm(null)} className="h-7 text-xs">
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newModelForm.name && newModelForm.apiKey && newModelForm.model && newModelForm.baseUrl) {
                        setAiConfig(addModel(aiConfig, newModelForm as Omit<AIModel, 'id'>))
                        setNewModelForm(null)
                      }
                    }}
                    disabled={!newModelForm.name || !newModelForm.apiKey || !newModelForm.model || !newModelForm.baseUrl}
                    className="h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    添加
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* 传统单模型配置（向后兼容） */}
          <div className="space-y-1.5">
            <Label className="text-sm">传统配置（向后兼容）</Label>
            <p className="text-xs text-muted-foreground">如果未配置多模型，将使用此配置</p>
          </div>

          {/* Provider 选择 */}
          <div className={settingsGroupClassName}>
            <Label className="text-xs">AI 服务商</Label>
            <ToggleGroup
              type="single"
              value={aiConfig.provider}
              onValueChange={(provider) => {
                if (provider === 'openai' || provider === 'anthropic') handleProviderChange(provider)
              }}
              variant="outline"
              size="sm"
              spacing={0}
            >
              <ToggleGroupItem value="openai">OpenAI</ToggleGroupItem>
              <ToggleGroupItem value="anthropic">Anthropic</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* API Key */}
          <div className={settingsGroupClassName}>
            <Label htmlFor="apiKey" className="text-xs">
              API Key
            </Label>
            <div className="flex gap-2">
              <Input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={aiConfig.apiKey}
                onChange={(e) => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                placeholder="输入 API Key"
                className="flex-1 h-8 text-sm"
              />
              <Button variant="outline" size="icon" onClick={() => setShowApiKey(!showApiKey)} className="h-8 w-8">
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Model */}
          <div className={settingsGroupClassName}>
            <Label htmlFor="model" className="text-xs">
              模型
            </Label>
            <Input
              id="model"
              value={aiConfig.model}
              onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
              placeholder="模型名称"
              className="h-8 text-sm"
            />
          </div>

          {/* API 端点 */}
          <div className={settingsGroupClassName}>
            <Label htmlFor="baseUrl" className="text-xs">
              API 端点
            </Label>
            <Input
              id="baseUrl"
              value={aiConfig.baseUrl}
              onChange={(e) => setAiConfig({ ...aiConfig, baseUrl: e.target.value })}
              placeholder={aiConfig.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.anthropic.com/v1/messages'}
              className="h-8 text-sm"
            />
          </div>

          {/* 测试结果 */}
          {aiTestMessage && (
            <Alert variant={aiTestResult === 'error' ? 'destructive' : 'default'}>
              {aiTestResult === 'success' ? <CheckCircle2 /> : aiTestResult === 'error' ? <XCircle /> : <AlertCircle />}
              <AlertTitle>{aiTestResult === 'success' ? '操作成功' : aiTestResult === 'error' ? '操作失败' : '处理中'}</AlertTitle>
              <AlertDescription>{aiTestMessage}</AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* 操作按钮 */}
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={handleAiReset}>
              <RotateCcw className="h-4 w-4 mr-1" />
              重置
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleAiTest} disabled={!isAIConfigValid(aiConfig) || saving}>
                测试连接
              </Button>
              <SaveButton size="sm" onClick={handleAiSave} disabled={saving}>
                <Save data-icon="inline-start" className="h-4 w-4" />
                {saving ? '保存中...' : '保存'}
              </SaveButton>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  )

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{body}</div>
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={600} storageKey="settings-panel">
        {body}
      </SheetContent>
    </Sheet>
  )
}

import { useState, useEffect } from 'react'
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
import { Settings, Save, RotateCcw, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react'
import { 
  getAIConfig, 
  saveAIConfig, 
  resetAIConfig, 
  isAIConfigValid,
  getDefaultValues,
  type AIConfig
} from '@/lib/ai-config-store'

interface AISettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AISettings({ open, onOpenChange }: AISettingsProps) {
  const [config, setConfig] = useState<AIConfig>(() => getAIConfig())
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (open) {
      setConfig(getAIConfig())
      setTestResult(null)
      setTestMessage('')
    }
  }, [open])

  const handleProviderChange = (provider: 'openai' | 'anthropic') => {
    const defaults = getDefaultValues(provider)
    setConfig({
      ...config,
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      saveAIConfig(config)
      setTestResult('success')
      setTestMessage('配置保存成功')
      setTimeout(() => {
        onOpenChange(false)
      }, 1000)
    } catch (error) {
      setTestResult('error')
      setTestMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    resetAIConfig()
    setConfig(getAIConfig())
    setTestResult(null)
    setTestMessage('')
  }

  const handleTest = async () => {
    if (!isAIConfigValid(config)) {
      setTestResult('error')
      setTestMessage('请填写完整的配置信息')
      return
    }

    setSaving(true)
    setTestResult(null)
    setTestMessage('测试中...')

    try {
      const url = config.baseUrl
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      let body: any

      if (config.provider === 'anthropic') {
        headers['x-api-key'] = config.apiKey
        headers['anthropic-version'] = '2023-06-01'
        body = {
          model: config.model,
          max_tokens: 100,
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: 'Say "test successful"' }],
          temperature: 0.3,
        }
      } else {
        headers['Authorization'] = `Bearer ${config.apiKey}`
        body = {
          model: config.model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "test successful"' }
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
      
      // 验证响应格式
      if (config.provider === 'anthropic') {
        if (!data.content?.[0]?.text) {
          throw new Error('API响应格式不正确')
        }
      } else {
        if (!data.choices?.[0]?.message?.content) {
          throw new Error('API响应格式不正确')
        }
      }

      setTestResult('success')
      setTestMessage('连接测试成功! API配置正常')
    } catch (error) {
      setTestResult('error')
      setTestMessage(error instanceof Error ? error.message : '测试失败')
    } finally {
      setSaving(false)
    }
  }

  const isValid = isAIConfigValid(config)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 flex flex-col" resizable defaultWidth={500} storageKey="ai-settings">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            AI 代码修复设置
          </SheetTitle>
          <SheetDescription>
            配置AI服务以启用智能代码修复功能。支持OpenAI和Anthropic。
          </SheetDescription>
        </SheetHeader>
        
        <Separator />
        
        <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用AI修复功能</Label>
              <p className="text-xs text-muted-foreground">
                开启后将在代码编辑器中显示AI修复按钮
              </p>
            </div>
            <Button
              variant={config.enabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            >
              {config.enabled ? '已启用' : '已禁用'}
            </Button>
          </div>

          <Separator />

          {/* AI服务提供商 */}
          <div className="space-y-2">
            <Label>AI服务提供商</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={config.provider === 'openai' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => handleProviderChange('openai')}
              >
                OpenAI
              </Button>
              <Button
                type="button"
                variant={config.provider === 'anthropic' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => handleProviderChange('anthropic')}
              >
                Anthropic
              </Button>
            </div>
          </div>

          {/* API密钥 */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">
              API密钥 <span className="text-red-500">*</span>
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder={config.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {config.provider === 'openai' 
                ? '从 platform.openai.com 获取API密钥'
                : '从 console.anthropic.com 获取API密钥'
              }
            </p>
          </div>

          {/* 模型 */}
          <div className="space-y-2">
            <Label htmlFor="model">
              模型 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="model"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={config.provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022'}
            />
            <p className="text-xs text-muted-foreground">
              {config.provider === 'openai' 
                ? '推荐: gpt-4o-mini (经济), gpt-4o (强大)'
                : '推荐: claude-3-5-sonnet-20241022 (平衡), claude-3-opus-20240229 (强大)'
              }
            </p>
          </div>

          {/* API端点 */}
          <div className="space-y-2">
            <Label htmlFor="baseUrl">API端点</Label>
            <Input
              id="baseUrl"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder={config.provider === 'openai' 
                ? 'https://api.openai.com/v1/chat/completions'
                : 'https://api.anthropic.com/v1/messages'
              }
            />
            <p className="text-xs text-muted-foreground">
              使用默认值或自定义代理地址
            </p>
          </div>

          {/* 测试结果 */}
          {testMessage && (
            <div className={`flex items-start gap-2 p-3 rounded-md border ${
              testResult === 'success' 
                ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                : testResult === 'error'
                ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
            }`}>
              {testResult === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />}
              {testResult === 'error' && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />}
              <span className={`text-xs flex-1 ${
                testResult === 'success' 
                  ? 'text-green-700 dark:text-green-300'
                  : testResult === 'error'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-blue-700 dark:text-blue-300'
              }`}>
                {testMessage}
              </span>
            </div>
          )}
        </div>

        <Separator />
        
        <div className="px-6 py-4 flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            重置
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!isValid || saving}
            >
              测试连接
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-1" />
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * AI配置状态徽章
 */
export function AIConfigBadge() {
  const config = getAIConfig()
  const isValid = isAIConfigValid(config)

  if (!config.enabled) {
    return (
      <Badge variant="outline" className="text-xs">
        AI修复: 未启用
      </Badge>
    )
  }

  if (!isValid) {
    return (
      <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
        AI修复: 未配置
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="text-xs text-green-600 border-green-300">
      AI修复: {config.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
    </Badge>
  )
}

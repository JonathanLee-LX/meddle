/**
 * AI配置存储服务
 * 使用localStorage保存AI配置
 */

export interface AIModel {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  apiKey: string
  baseUrl: string
  model: string
}

export interface AIConfig {
  enabled: boolean
  provider: 'openai' | 'anthropic'
  apiKey: string
  baseUrl: string
  model: string
  models?: AIModel[]
  activeModelId?: string
}

const STORAGE_KEY = 'meddle-ai-config'

const DEFAULT_CONFIG: AIConfig = {
  enabled: false,
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
}

const DEFAULT_URLS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
}

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
}

/**
 * 获取AI配置
 */
export function getAIConfig(): AIConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const config = JSON.parse(stored) as AIConfig
      
      // 填充默认值
      if (!config.baseUrl) {
        config.baseUrl = DEFAULT_URLS[config.provider]
      }
      if (!config.model) {
        config.model = DEFAULT_MODELS[config.provider]
      }
      
      // 初始化 models 数组（向后兼容）
      if (!config.models) {
        config.models = []
      }
      
      return config
    }
  } catch (error) {
    console.error('读取AI配置失败:', error)
  }
  
  // 尝试从环境变量读取
  const envConfig = getConfigFromEnv()
  if (envConfig) {
    return envConfig
  }
  
  return { ...DEFAULT_CONFIG, models: [] }
}

/**
 * 从环境变量读取配置
 */
function getConfigFromEnv(): AIConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY
  
  if (!apiKey) {
    return null
  }
  
  const provider = (import.meta.env.VITE_AI_PROVIDER || 'openai') as 'openai' | 'anthropic'
  const baseUrl = import.meta.env.VITE_AI_BASE_URL || DEFAULT_URLS[provider]
  const model = import.meta.env.VITE_AI_MODEL || DEFAULT_MODELS[provider]
  
  return {
    enabled: true,
    provider,
    apiKey,
    baseUrl,
    model,
  }
}

/**
 * 保存AI配置
 */
export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.error('保存AI配置失败:', error)
    throw new Error('保存配置失败')
  }
}

/**
 * 重置AI配置
 */
export function resetAIConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('重置AI配置失败:', error)
  }
}

/**
 * 检查AI配置是否可用
 */
export function isAIConfigValid(config: AIConfig): boolean {
  return config.enabled && !!config.apiKey && !!config.baseUrl && !!config.model
}

/**
 * 获取默认配置值
 */
export function getDefaultValues(provider: 'openai' | 'anthropic') {
  return {
    baseUrl: DEFAULT_URLS[provider],
    model: DEFAULT_MODELS[provider],
  }
}

/**
 * 获取当前激活的模型配置
 */
export function getActiveModel(config: AIConfig): AIModel | null {
  if (!config.models || config.models.length === 0) {
    return null
  }
  
  if (config.activeModelId) {
    const activeModel = config.models.find(m => m.id === config.activeModelId)
    if (activeModel) {
      return activeModel
    }
  }
  
  return config.models[0]
}

/**
 * 添加新的模型配置
 */
export function addModel(config: AIConfig, model: Omit<AIModel, 'id'>): AIConfig {
  const newModel: AIModel = {
    ...model,
    id: Date.now().toString(),
  }
  
  const newModels = [...(config.models || []), newModel]
  
  return {
    ...config,
    models: newModels,
    activeModelId: config.activeModelId || newModel.id,
  }
}

/**
 * 更新模型配置
 */
export function updateModel(config: AIConfig, modelId: string, updates: Partial<AIModel>): AIConfig {
  const newModels = (config.models || []).map(m =>
    m.id === modelId ? { ...m, ...updates } : m
  )
  
  return {
    ...config,
    models: newModels,
  }
}

/**
 * 删除模型配置
 */
export function deleteModel(config: AIConfig, modelId: string): AIConfig {
  const newModels = (config.models || []).filter(m => m.id !== modelId)
  
  let newActiveModelId = config.activeModelId
  if (config.activeModelId === modelId && newModels.length > 0) {
    newActiveModelId = newModels[0].id
  }
  
  return {
    ...config,
    models: newModels,
    activeModelId: newActiveModelId,
  }
}

/**
 * 设置激活的模型
 */
export function setActiveModel(config: AIConfig, modelId: string): AIConfig {
  return {
    ...config,
    activeModelId: modelId,
  }
}

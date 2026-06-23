/**
 * 系统设置存储服务
 * 使用文件系统保存设置到 ~/.ep/settings.json
 */

import { saveAIConfig } from './ai-config-store'
import type { AIConfig } from './ai-config-store'

export type AccentColor = 'auto' | 'neutral' | 'blue' | 'violet' | 'green' | 'orange' | 'rose'

export interface SystemSettings {
  theme: 'light' | 'dark' | 'system'
  accentColor: AccentColor
  fontSize: string
  aiConfig: AIConfig
  mocksFilePath?: string
  pluginMode?: 'off' | 'shadow' | 'on'
  clientAliases?: Record<string, string>
}

const DEFAULT_SETTINGS: SystemSettings = {
  theme: 'system',
  accentColor: 'auto',
  fontSize: 'medium',
  aiConfig: {
    enabled: false,
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    models: []
  },
  mocksFilePath: '',
  pluginMode: 'off',
  clientAliases: {}
}

// 内存缓存
let cachedSettings: SystemSettings | null = null

/**
 * 从服务器加载设置
 */
export async function loadSettings(): Promise<SystemSettings> {
  try {
    const response = await fetch('/api/settings')
    if (response.ok) {
      const settings = await response.json()
      const mergedSettings: SystemSettings = {
        ...DEFAULT_SETTINGS,
        ...settings,
        accentColor: settings.accentColor || DEFAULT_SETTINGS.accentColor,
        aiConfig: {
          ...DEFAULT_SETTINGS.aiConfig,
          ...settings.aiConfig,
        },
      }
      cachedSettings = mergedSettings

      // 同步 AI 配置到 localStorage
      saveAIConfig(mergedSettings.aiConfig)

      return mergedSettings
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
  
  // 如果加载失败，尝试从 localStorage 迁移
  const migratedSettings = migrateFromLocalStorage()
  if (migratedSettings) {
    cachedSettings = migratedSettings
    // 保存迁移后的设置到文件系统
    saveSettings(migratedSettings).catch(console.error)
    return migratedSettings
  }
  
  cachedSettings = { ...DEFAULT_SETTINGS }
  return cachedSettings
}

/**
 * 保存设置到服务器
 */
export async function saveSettings(settings: SystemSettings): Promise<void> {
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    })
    
    if (response.ok) {
      cachedSettings = settings
    } else {
      throw new Error('保存设置失败')
    }
  } catch (error) {
    console.error('保存设置失败:', error)
    throw error
  }
}

/**
 * 获取缓存的设置（同步方法）
 */
export function getCachedSettings(): SystemSettings {
  return cachedSettings || { ...DEFAULT_SETTINGS }
}

/**
 * 更新设置的部分字段
 */
export async function updateSettings(updates: Partial<SystemSettings>): Promise<void> {
  // 确保先加载最新的设置
  let currentSettings = getCachedSettings()
  if (!currentSettings || !currentSettings.aiConfig?.apiKey) {
    currentSettings = await loadSettings()
  }
  const newSettings = { ...currentSettings, ...updates }
  await saveSettings(newSettings)
}

/**
 * 从 localStorage 迁移设置
 */
function migrateFromLocalStorage(): SystemSettings | null {
  try {
    const theme = localStorage.getItem('theme-storage')
    const fontSize = localStorage.getItem('font-size')
    const aiConfigStr = localStorage.getItem('easy-proxy-ai-config')
    
    if (!theme && !fontSize && !aiConfigStr) {
      return null
    }
    
    const settings: SystemSettings = { ...DEFAULT_SETTINGS }
    
    if (theme) {
      try {
        const themeData = JSON.parse(theme)
        settings.theme = themeData.theme || 'system'
      } catch {
        // ignore
      }
    }
    
    if (fontSize) {
      settings.fontSize = fontSize
    }
    
    if (aiConfigStr) {
      try {
        const aiConfig = JSON.parse(aiConfigStr)
        settings.aiConfig = aiConfig
      } catch {
        // ignore
      }
    }
    
    console.log('已从 localStorage 迁移设置')
    return settings
  } catch (error) {
    console.error('迁移设置失败:', error)
    return null
  }
}

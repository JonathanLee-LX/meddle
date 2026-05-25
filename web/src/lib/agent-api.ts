import { getActiveModel, getAIConfig, isAIConfigValid, type AIConfig } from './ai-config-store'

export interface AgentPendingConfirmation {
  id: string
  runId: string
  toolName: string
  summary: string
  diff?: string
  preview?: unknown
  createdAt: number
}

export interface AgentChatResponse {
  runId: string
  message: string
  pendingConfirmations: AgentPendingConfirmation[]
  toolResults: unknown[]
}

export interface AgentConfirmResponse {
  status: 'executed' | 'cancelled'
  message: string
  result?: unknown
}

export function resolveAgentAIConfig(): AIConfig {
  const config = getAIConfig()
  const activeModel = getActiveModel(config)
  if (!activeModel) return config

  return {
    ...config,
    provider: activeModel.provider,
    apiKey: activeModel.apiKey,
    baseUrl: activeModel.baseUrl,
    model: activeModel.model,
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`)
  }
  return data
}

export async function sendAgentMessage(message: string): Promise<AgentChatResponse> {
  const aiConfig = resolveAgentAIConfig()
  if (!isAIConfigValid(aiConfig)) {
    throw new Error('请先在系统设置中启用并填写可用的 AI 配置。')
  }

  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, aiConfig }),
  })
  return parseJsonResponse<AgentChatResponse>(response)
}

export async function confirmAgentAction(confirmationId: string, approved: boolean): Promise<AgentConfirmResponse> {
  const response = await fetch('/api/agent/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmationId, approved }),
  })
  return parseJsonResponse<AgentConfirmResponse>(response)
}

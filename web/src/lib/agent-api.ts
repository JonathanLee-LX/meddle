import { getActiveModel, getAIConfig, isAIConfigValid, type AIConfig } from './ai-config-store'

export interface AgentPendingConfirmation {
  id: string
  runId: string
  toolCallId: string
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
  conversationId: string
}

export interface AgentConfirmResponse {
  status: 'executed' | 'cancelled'
  message: string
  result?: unknown
}

export interface AgentStreamHandlers {
  onDelta?: (delta: string) => void
  onStart?: () => void
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

function parseSseData(eventBlock: string) {
  const lines = eventBlock.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  return { event, data }
}

export async function streamAgentMessage(
  message: string,
  handlers: AgentStreamHandlers = {},
  conversationId?: string,
): Promise<AgentChatResponse> {
  const aiConfig = resolveAgentAIConfig()
  if (!isAIConfigValid(aiConfig)) {
    throw new Error('请先在系统设置中启用并填写可用的 AI 配置。')
  }

  const response = await fetch('/api/agent/chat-stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, aiConfig, ...(conversationId ? { conversationId } : {}) }),
  })

  if (!response.ok || !response.body) {
    return parseJsonResponse<AgentChatResponse>(response)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleBlock = (block: string): AgentChatResponse | null => {
    const { event, data } = parseSseData(block)
    if (!data) return null
    const payload = JSON.parse(data) as Record<string, unknown>

    if (event === 'start') {
      handlers.onStart?.()
      return null
    }
    if (event === 'delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : ''
      if (delta) handlers.onDelta?.(delta)
      return null
    }
    if (event === 'error') {
      throw new Error(typeof payload.error === 'string' ? payload.error : 'AI 请求失败')
    }
    if (event === 'done') {
      return payload as unknown as AgentChatResponse
    }
    return null
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const blocks = buffer.split(/\n\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const result = handleBlock(block)
      if (result) return result
    }
    if (done) break
  }

  if (buffer.trim()) {
    const result = handleBlock(buffer)
    if (result) return result
  }

  throw new Error('AI 流式响应未返回完成事件')
}

export async function confirmAgentAction(confirmationId: string, approved: boolean): Promise<AgentConfirmResponse> {
  const response = await fetch('/api/agent/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmationId, approved }),
  })
  return parseJsonResponse<AgentConfirmResponse>(response)
}

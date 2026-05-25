import type { AgentAIConfig, AgentToolDefinition } from './types'

export interface AgentModelToolCall {
    id: string
    name: string
    arguments: string
}

export interface AgentChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_call_id?: string
    reasoning_content?: string
    tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
            name: string
            arguments: string
        }
    }>
}

export interface AgentModelResponse {
    content: string
    reasoningContent?: string
    toolCalls: AgentModelToolCall[]
}

function normalizeOpenAIChatUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/$/, '')
    if (/\/chat\/completions$/i.test(trimmed)) return trimmed
    if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`
    return trimmed
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function parseToolCalls(value: unknown): AgentModelToolCall[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((item, index) => {
        const call = asObject(item)
        const fn = asObject(call.function)
        const name = typeof fn.name === 'string' ? fn.name : ''
        if (!name) return []
        const args = typeof fn.arguments === 'string' ? fn.arguments : '{}'
        const id = typeof call.id === 'string' ? call.id : `tool-call-${index}`
        return [{ id, name, arguments: args }]
    })
}

export async function requestAgentModel(
    config: AgentAIConfig,
    messages: AgentChatMessage[],
    tools: AgentToolDefinition[],
): Promise<AgentModelResponse> {
    if (config.provider !== 'openai') {
        throw new Error('当前命令面板 Agent MVP 仅支持 OpenAI-compatible Chat Completions。')
    }

    const response = await fetch(normalizeOpenAIChatUrl(config.baseUrl), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            temperature: 0.1,
            messages,
            tools,
            tool_choice: 'auto',
            max_tokens: 1200,
        }),
    })

    const text = await response.text()
    if (!response.ok) {
        throw new Error(`AI 请求失败: ${response.status} ${text.slice(0, 300)}`)
    }

    const payload = JSON.parse(text) as Record<string, unknown>
    const choices = Array.isArray(payload.choices) ? payload.choices : []
    const firstChoice = asObject(choices[0])
    const message = asObject(firstChoice.message)
    const content = typeof message.content === 'string' ? message.content : ''
    const reasoningContent = typeof message.reasoning_content === 'string'
        ? message.reasoning_content
        : undefined

    return {
        content,
        reasoningContent,
        toolCalls: parseToolCalls(message.tool_calls),
    }
}

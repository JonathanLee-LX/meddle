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

export interface AgentModelStreamOptions {
    onContentDelta?: (delta: string) => void
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
    streamOptions: AgentModelStreamOptions = {},
): Promise<AgentModelResponse> {
    if (config.provider !== 'openai') {
        throw new Error('当前命令面板 Agent MVP 仅支持 OpenAI-compatible Chat Completions。')
    }

    const stream = Boolean(streamOptions.onContentDelta)
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
            ...(stream ? { stream: true } : {}),
        }),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`AI 请求失败: ${response.status} ${text.slice(0, 300)}`)
    }

    if (stream) {
        return readStreamingResponse(response, streamOptions)
    }

    const text = await response.text()
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

async function readStreamingResponse(
    response: Response,
    streamOptions: AgentModelStreamOptions,
): Promise<AgentModelResponse> {
    if (!response.body) {
        throw new Error('AI 流式响应不可用')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const toolCallParts = new Map<number, AgentModelToolCall>()
    let buffer = ''
    let content = ''
    let reasoningContent = ''

    const handlePayload = (payload: Record<string, unknown>) => {
        const choices = Array.isArray(payload.choices) ? payload.choices : []
        const firstChoice = asObject(choices[0])
        const delta = asObject(firstChoice.delta)
        const contentDelta = typeof delta.content === 'string' ? delta.content : ''
        if (contentDelta) {
            content += contentDelta
            streamOptions.onContentDelta?.(contentDelta)
        }
        const reasoningDelta = typeof delta.reasoning_content === 'string'
            ? delta.reasoning_content
            : ''
        if (reasoningDelta) {
            reasoningContent += reasoningDelta
        }

        const toolCallDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
        for (const rawCall of toolCallDeltas) {
            const call = asObject(rawCall)
            const index = typeof call.index === 'number' ? call.index : toolCallParts.size
            const existing = toolCallParts.get(index) || { id: `tool-call-${index}`, name: '', arguments: '' }
            if (typeof call.id === 'string') existing.id = call.id
            const fn = asObject(call.function)
            if (typeof fn.name === 'string') existing.name += fn.name
            if (typeof fn.arguments === 'string') existing.arguments += fn.arguments
            toolCallParts.set(index, existing)
        }
    }

    const handleEventBlock = (block: string) => {
        const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
            .trim()
        if (!data || data === '[DONE]') return
        handlePayload(JSON.parse(data) as Record<string, unknown>)
    }

    while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const blocks = buffer.split(/\n\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
            handleEventBlock(block)
        }
        if (done) break
    }

    if (buffer.trim()) {
        handleEventBlock(buffer)
    }

    return {
        content,
        reasoningContent: reasoningContent || undefined,
        toolCalls: Array.from(toolCallParts.values()).filter((call) => call.name),
    }
}

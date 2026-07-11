import { randomUUID } from 'crypto'
import { requestAgentModel, type AgentChatMessage } from './model'
import { toToolDefinitions } from './tools'
import type {
    AgentChatRequest,
    AgentChatResponse,
    AgentPendingConfirmation,
    AgentTool,
    AgentToolContext,
} from './types'

const MAX_TOOL_STEPS = 6

const SYSTEM_PROMPT = [
    '你是 Easy Proxy 的命令面板 Agent，负责通过工具读取和修改本地代理应用状态。',
    '必须通过工具确认真实状态，不要凭空声称已经修改配置。',
    '写入类工具会返回确认请求。触发确认请求后，停止继续执行并等待用户确认。',
    '处理路由规则时，先查看启用的规则文件。若只有一个启用文件，默认写入该文件；若有多个且用户未指定，先向用户询问要写入哪个文件。',
    '路由规则 pattern 匹配完整 URL。形如 *.wps.cn 可匹配 wps.cn、plus.wps.cn 和多级子域；target 为 1.1.1.1 这类 host 时会继承原请求协议、路径和 query。',
    '回答要简洁，使用中文。'
].join('\n')

export interface AgentRuntimeEvents {
    onContentDelta?: (delta: string) => void
}

export interface AgentRunResult {
    response: AgentChatResponse
    messages: AgentChatMessage[]
}

function parseToolArguments(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw || '{}') as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>
        }
    } catch (err) {
        throw new Error(`工具参数不是合法 JSON: ${(err as Error).message}`)
    }
    throw new Error('工具参数必须是对象')
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return JSON.stringify({ error: '工具结果无法序列化' })
    }
}

function buildMessages(history: AgentChatMessage[] | undefined, userMessage: string): AgentChatMessage[] {
    const previousMessages = (history || []).filter((message) => message.role !== 'system')
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        ...previousMessages,
        { role: 'user', content: userMessage },
    ]
}

function pendingToolResult(confirmation: AgentPendingConfirmation): AgentChatMessage {
    return {
        role: 'tool',
        tool_call_id: confirmation.toolCallId,
        content: safeJson({
            status: 'confirmation_required',
            confirmationId: confirmation.id,
            summary: confirmation.summary,
        }),
    }
}

function skippedToolResult(toolCallId: string): AgentChatMessage {
    return {
        role: 'tool',
        tool_call_id: toolCallId,
        content: safeJson({
            status: 'skipped',
            reason: 'waiting_for_confirmation',
        }),
    }
}

export function completeConfirmationInHistory(
    history: AgentChatMessage[],
    toolCallId: string,
    result: unknown,
): AgentChatMessage[] {
    let replaced = false
    const messages = history.map((message) => {
        if (!replaced && message.role === 'tool' && message.tool_call_id === toolCallId) {
            replaced = true
            return {
                ...message,
                content: safeJson(result),
            }
        }
        return message
    })

    if (!replaced) {
        messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: safeJson(result),
        })
    }
    return messages
}

export async function runAgent(
    request: AgentChatRequest,
    toolRegistry: Map<string, AgentTool>,
    toolContext: AgentToolContext,
    createConfirmation: (confirmation: Omit<AgentPendingConfirmation, 'id' | 'createdAt'>) => AgentPendingConfirmation,
    events: AgentRuntimeEvents = {},
    history?: AgentChatMessage[],
): Promise<AgentRunResult> {
    const runId = randomUUID()
    const messages = buildMessages(history, request.message)
    const toolResults: unknown[] = []
    const pendingConfirmations: AgentPendingConfirmation[] = []

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        const response = await requestAgentModel(request.aiConfig, messages, toToolDefinitions(toolRegistry), {
            onContentDelta: events.onContentDelta,
        })

        if (response.toolCalls.length === 0) {
            if (response.content) {
                messages.push({ role: 'assistant', content: response.content })
            }
            return {
                response: {
                    runId,
                    message: response.content || '已完成。',
                    pendingConfirmations,
                    toolResults,
                    conversationId: '',
                },
                messages,
            }
        }

        const assistantMessage: AgentChatMessage = {
            role: 'assistant',
            content: response.content || null,
            tool_calls: response.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                    name: call.name,
                    arguments: call.arguments,
                },
            })),
        }
        if (response.reasoningContent) {
            assistantMessage.reasoning_content = response.reasoningContent
        }
        messages.push(assistantMessage)

        for (let callIndex = 0; callIndex < response.toolCalls.length; callIndex += 1) {
            const call = response.toolCalls[callIndex]
            const tool = toolRegistry.get(call.name)
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: safeJson({ error: `未知工具: ${call.name}` }),
                })
                continue
            }

            let input: Record<string, unknown>
            try {
                input = parseToolArguments(call.arguments)
            } catch (err) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: safeJson({ error: (err as Error).message }),
                })
                continue
            }

            if (tool.requiresConfirmation) {
                const prepared = tool.prepareConfirmation
                    ? await tool.prepareConfirmation(input, toolContext)
                    : { summary: `执行工具 ${tool.name}`, input }
                const confirmation = createConfirmation({
                    runId,
                    toolCallId: call.id,
                    toolName: tool.name,
                    summary: prepared.summary,
                    diff: prepared.diff,
                    preview: prepared.preview,
                    input: prepared.input,
                })
                pendingConfirmations.push(confirmation)
                messages.push(pendingToolResult(confirmation))
                for (const remainingCall of response.toolCalls.slice(callIndex + 1)) {
                    messages.push(skippedToolResult(remainingCall.id))
                }
                return {
                    response: {
                        runId,
                        message: '需要确认后才能执行写入操作。',
                        pendingConfirmations,
                        toolResults,
                        conversationId: '',
                    },
                    messages,
                }
            }

            try {
                const result = await tool.execute(input, toolContext)
                toolResults.push({ toolName: tool.name, result })
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: safeJson(result),
                })
            } catch (err) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: safeJson({ error: (err as Error).message }),
                })
            }
        }
    }

    return {
        response: {
            runId,
            message: 'Agent 已达到工具调用步数上限，请把需求拆小后重试。',
            pendingConfirmations,
            toolResults,
            conversationId: '',
        },
        messages,
    }
}

import { randomUUID } from 'crypto'
import type { Application, Request, Response } from 'express'
import type { ServerContext } from '../index'
import { createAgentTools, describeAgentTools } from './tools'
import { completeConfirmationInHistory, runAgent } from './runtime'
import type { AgentChatMessage } from './model'
import type { AgentAIConfig, AgentChatRequest, AgentPendingConfirmation } from './types'

const MAX_CONVERSATIONS = 100

interface StoredPendingConfirmation extends AgentPendingConfirmation {
    conversationId: string
}

const pendingConfirmations = new Map<string, StoredPendingConfirmation>()
const conversations = new Map<string, AgentChatMessage[]>()

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function parseAIConfig(value: unknown): AgentAIConfig {
    const config = asObject(value)
    const provider = config.provider
    if (provider !== 'openai' && provider !== 'anthropic') {
        throw new Error('AI provider 无效')
    }
    return {
        enabled: config.enabled === true,
        provider,
        apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
        baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
        model: typeof config.model === 'string' ? config.model : '',
    }
}

function parseChatRequest(value: unknown): AgentChatRequest {
    const body = asObject(value)
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
        throw new Error('缺少消息内容')
    }
    const aiConfig = parseAIConfig(body.aiConfig)
    if (!aiConfig.enabled || !aiConfig.apiKey || !aiConfig.baseUrl || !aiConfig.model) {
        throw new Error('AI 配置不可用')
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined
    return { message, aiConfig, conversationId }
}

function getOrCreateConversationId(request: AgentChatRequest): string {
    if (request.conversationId && conversations.has(request.conversationId)) {
        return request.conversationId
    }
    return randomUUID()
}

function pruneConversations(): void {
    while (conversations.size > MAX_CONVERSATIONS) {
        const oldest = conversations.keys().next().value
        if (oldest) conversations.delete(oldest)
    }
}

function sendJson(res: Response, statusCode: number, payload: unknown): void {
    res.status(statusCode).json(payload)
}

function writeSse(res: Response, event: string, payload: unknown): void {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export function registerAgentRoutes(app: Application, ctx: ServerContext): void {
    const tools = createAgentTools()
    const toolContext = { serverContext: ctx }

    app.get('/api/agent/tools', (_req: Request, res: Response) => {
        sendJson(res, 200, describeAgentTools(tools))
    })

    app.post('/api/agent/chat', async (req: Request, res: Response) => {
        try {
            const chatRequest = parseChatRequest(req.body)
            const conversationId = getOrCreateConversationId(chatRequest)
            const history = conversations.get(conversationId)
            const result = await runAgent(chatRequest, tools, toolContext, (confirmation) => {
                const item: AgentPendingConfirmation = {
                    ...confirmation,
                    id: randomUUID(),
                    createdAt: Date.now(),
                }
                pendingConfirmations.set(item.id, { ...item, conversationId })
                return item
            }, {}, history)
            conversations.set(conversationId, result.messages)
            pruneConversations()
            sendJson(res, 200, { ...result.response, conversationId })
        } catch (err) {
            sendJson(res, 400, { error: (err as Error).message })
        }
    })

    app.post('/api/agent/chat-stream', async (req: Request, res: Response) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        })
        try {
            const chatRequest = parseChatRequest(req.body)
            const conversationId = getOrCreateConversationId(chatRequest)
            const history = conversations.get(conversationId)
            writeSse(res, 'start', { status: 'running' })
            const result = await runAgent(chatRequest, tools, toolContext, (confirmation) => {
                const item: AgentPendingConfirmation = {
                    ...confirmation,
                    id: randomUUID(),
                    createdAt: Date.now(),
                }
                pendingConfirmations.set(item.id, { ...item, conversationId })
                return item
            }, {
                onContentDelta: (delta) => writeSse(res, 'delta', { delta }),
            }, history)
            conversations.set(conversationId, result.messages)
            pruneConversations()
            writeSse(res, 'done', { ...result.response, conversationId })
        } catch (err) {
            writeSse(res, 'error', { error: (err as Error).message })
        } finally {
            res.end()
        }
    })

    app.post('/api/agent/confirm', async (req: Request, res: Response) => {
        try {
            const body = asObject(req.body)
            const confirmationId = typeof body.confirmationId === 'string' ? body.confirmationId : ''
            const approved = body.approved === true
            if (!confirmationId) {
                throw new Error('缺少 confirmationId')
            }
            const pending = pendingConfirmations.get(confirmationId)
            if (!pending) {
                sendJson(res, 404, { error: '确认请求不存在或已过期' })
                return
            }

            pendingConfirmations.delete(confirmationId)
            if (!approved) {
                const cancellation = {
                    status: 'cancelled',
                    toolName: pending.toolName,
                    message: '用户取消了写入操作。',
                }
                const history = conversations.get(pending.conversationId)
                if (history) {
                    conversations.set(
                        pending.conversationId,
                        completeConfirmationInHistory(history, pending.toolCallId, cancellation),
                    )
                }
                sendJson(res, 200, { status: 'cancelled', message: '已取消执行。' })
                return
            }

            const tool = tools.get(pending.toolName)
            if (!tool) {
                throw new Error(`工具不存在: ${pending.toolName}`)
            }

            let result: unknown
            try {
                result = await tool.execute(pending.input, toolContext)
            } catch (err) {
                const failure = {
                    status: 'error',
                    toolName: pending.toolName,
                    error: (err as Error).message,
                }
                const history = conversations.get(pending.conversationId)
                if (history) {
                    conversations.set(
                        pending.conversationId,
                        completeConfirmationInHistory(history, pending.toolCallId, failure),
                    )
                }
                throw err
            }
            const history = conversations.get(pending.conversationId)
            if (history) {
                conversations.set(
                    pending.conversationId,
                    completeConfirmationInHistory(history, pending.toolCallId, {
                        status: 'executed',
                        toolName: pending.toolName,
                        result,
                    }),
                )
            }
            sendJson(res, 200, {
                status: 'executed',
                message: '已执行。',
                result,
            })
        } catch (err) {
            sendJson(res, 400, { error: (err as Error).message })
        }
    })
}

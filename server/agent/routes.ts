import { randomUUID } from 'crypto'
import type { Application, Request, Response } from 'express'
import type { ServerContext } from '../index'
import { createAgentTools, describeAgentTools } from './tools'
import { runAgent } from './runtime'
import type { AgentAIConfig, AgentChatRequest, AgentPendingConfirmation } from './types'

const pendingConfirmations = new Map<string, AgentPendingConfirmation>()

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
    return { message, aiConfig }
}

function sendJson(res: Response, statusCode: number, payload: unknown): void {
    res.status(statusCode).json(payload)
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
            const response = await runAgent(chatRequest, tools, toolContext, (confirmation) => {
                const item: AgentPendingConfirmation = {
                    ...confirmation,
                    id: randomUUID(),
                    createdAt: Date.now(),
                }
                pendingConfirmations.set(item.id, item)
                return item
            })
            sendJson(res, 200, response)
        } catch (err) {
            sendJson(res, 400, { error: (err as Error).message })
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
                sendJson(res, 200, { status: 'cancelled', message: '已取消执行。' })
                return
            }

            const tool = tools.get(pending.toolName)
            if (!tool) {
                throw new Error(`工具不存在: ${pending.toolName}`)
            }

            const result = await tool.execute(pending.input, toolContext)
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

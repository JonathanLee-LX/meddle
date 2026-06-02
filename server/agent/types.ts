import type { ServerContext } from '../index'

export type AgentProvider = 'openai' | 'anthropic'
export type AgentToolRisk = 'read' | 'write' | 'destructive' | 'network' | 'exec'

export interface AgentAIConfig {
    enabled: boolean
    provider: AgentProvider
    apiKey: string
    baseUrl: string
    model: string
}

export interface AgentToolDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

export interface AgentToolContext {
    serverContext: ServerContext
}

export interface AgentToolConfirmation {
    summary: string
    diff?: string
    preview?: unknown
    input: Record<string, unknown>
}

export interface AgentTool<Output = unknown> {
    name: string
    description: string
    risk: AgentToolRisk
    requiresConfirmation: boolean
    parameters: Record<string, unknown>
    execute: (input: Record<string, unknown>, ctx: AgentToolContext) => Promise<Output> | Output
    prepareConfirmation?: (input: Record<string, unknown>, ctx: AgentToolContext) => Promise<AgentToolConfirmation> | AgentToolConfirmation
}

export interface AgentPendingConfirmation extends AgentToolConfirmation {
    id: string
    runId: string
    toolName: string
    createdAt: number
}

export interface AgentChatRequest {
    message: string
    aiConfig: AgentAIConfig
    conversationId?: string
}

export interface AgentChatResponse {
    runId: string
    message: string
    pendingConfirmations: AgentPendingConfirmation[]
    toolResults: unknown[]
    conversationId: string
}

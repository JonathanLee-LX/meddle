import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgent } from '../server/agent/runtime'
import type { AgentTool } from '../server/agent/types'
import type { ServerContext } from '../server/index'

const mockFetch = vi.fn()

describe('agent runtime', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('passes reasoning_content back when continuing a thinking-mode tool call', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{
                        message: {
                            content: '',
                            reasoning_content: '先读取当前启用的规则文件。',
                            tool_calls: [{
                                id: 'call-1',
                                type: 'function',
                                function: {
                                    name: 'route_rule_active_get',
                                    arguments: '{}',
                                },
                            }],
                        },
                    }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{
                        message: {
                            content: '需要确认后执行。',
                            tool_calls: [],
                        },
                    }],
                }),
            })

        const tool: AgentTool = {
            name: 'route_rule_active_get',
            description: '查看当前启用的路由规则文件',
            risk: 'read',
            requiresConfirmation: false,
            parameters: { type: 'object', properties: {} },
            execute: () => ({ activeRuleFiles: ['默认规则'], currentRuleFile: '默认规则' }),
        }

        await runAgent(
            {
                message: '添加一条路由规则',
                aiConfig: {
                    enabled: true,
                    provider: 'openai',
                    apiKey: 'test-key',
                    baseUrl: 'https://example.test/v1/chat/completions',
                    model: 'thinking-model',
                },
            },
            new Map([[tool.name, tool]]),
            { serverContext: {} as ServerContext },
            (confirmation) => ({
                ...confirmation,
                id: 'confirmation-1',
                createdAt: Date.now(),
            }),
        )

        const secondRequest = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
            messages: Array<{ role: string; reasoning_content?: string }>
        }
        const assistantMessage = secondRequest.messages.find((message) => message.role === 'assistant')

        expect(assistantMessage?.reasoning_content).toBe('先读取当前启用的规则文件。')
    })

    it('streams final content deltas while preserving the completed response', async () => {
        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"，第二段"}}]}\n\n'))
                controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                controller.close()
            },
        })
        mockFetch.mockResolvedValueOnce({
            ok: true,
            body: stream,
        })

        const deltas: string[] = []
        const result = await runAgent(
            {
                message: '解释当前状态',
                aiConfig: {
                    enabled: true,
                    provider: 'openai',
                    apiKey: 'test-key',
                    baseUrl: 'https://example.test/v1/chat/completions',
                    model: 'stream-model',
                },
            },
            new Map(),
            { serverContext: {} as ServerContext },
            (confirmation) => ({
                ...confirmation,
                id: 'confirmation-1',
                createdAt: Date.now(),
            }),
            {
                onContentDelta: (delta) => deltas.push(delta),
            },
        )

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { stream: boolean }

        expect(requestBody.stream).toBe(true)
        expect(deltas).toEqual(['第一段', '，第二段'])
        expect(result.response.message).toBe('第一段，第二段')
    })
})

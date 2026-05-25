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
})

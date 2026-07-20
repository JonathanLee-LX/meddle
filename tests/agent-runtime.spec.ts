import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeConfirmationInHistory, runAgent } from '../server/agent/runtime'
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

    it('keeps confirmation tool calls valid for the next conversation turn', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'write-call',
                                    type: 'function',
                                    function: {
                                        name: 'route_rule_add',
                                        arguments: JSON.stringify({
                                            ruleFile: '默认规则',
                                            pattern: '*.google.com',
                                            target: '1.1.1.1',
                                        }),
                                    },
                                },
                                {
                                    id: 'later-call',
                                    type: 'function',
                                    function: {
                                        name: 'route_rule_active_get',
                                        arguments: '{}',
                                    },
                                },
                            ],
                        },
                    }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{
                        message: {
                            content: '可以继续处理。',
                            tool_calls: [],
                        },
                    }],
                }),
            })

        const writeTool: AgentTool = {
            name: 'route_rule_add',
            description: '添加路由规则',
            risk: 'write',
            requiresConfirmation: true,
            parameters: { type: 'object', properties: {} },
            prepareConfirmation: (input) => ({
                summary: '添加路由规则',
                input,
            }),
            execute: () => ({ status: 'success' }),
        }
        const readTool: AgentTool = {
            name: 'route_rule_active_get',
            description: '读取启用规则',
            risk: 'read',
            requiresConfirmation: false,
            parameters: { type: 'object', properties: {} },
            execute: () => ({ activeRuleFiles: ['默认规则'] }),
        }
        const tools = new Map([
            [writeTool.name, writeTool],
            [readTool.name, readTool],
        ])
        const createConfirmation = (confirmation: Parameters<Parameters<typeof runAgent>[3]>[0]) => ({
            ...confirmation,
            id: 'confirmation-1',
            createdAt: Date.now(),
        })
        const request = {
            message: '将 Google 域名代理到 1.1.1.1',
            aiConfig: {
                enabled: true,
                provider: 'openai' as const,
                apiKey: 'test-key',
                baseUrl: 'https://example.test/v1/chat/completions',
                model: 'test-model',
            },
        }

        const firstRun = await runAgent(
            request,
            tools,
            { serverContext: {} as ServerContext },
            createConfirmation,
        )

        expect(firstRun.response.pendingConfirmations[0]).toMatchObject({
            id: 'confirmation-1',
            toolCallId: 'write-call',
            toolName: 'route_rule_add',
        })
        expect(firstRun.messages.slice(-2)).toEqual([
            expect.objectContaining({
                role: 'tool',
                tool_call_id: 'write-call',
                content: expect.stringContaining('confirmation_required'),
            }),
            expect.objectContaining({
                role: 'tool',
                tool_call_id: 'later-call',
                content: expect.stringContaining('waiting_for_confirmation'),
            }),
        ])

        await runAgent(
            { ...request, message: '继续' },
            tools,
            { serverContext: {} as ServerContext },
            createConfirmation,
            {},
            firstRun.messages,
        )

        const secondRequest = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
            messages: Array<{
                role: string
                tool_calls?: Array<{ id: string }>
                tool_call_id?: string
            }>
        }
        expect(secondRequest.messages.filter((message) => message.role === 'system')).toHaveLength(1)

        const assistantIndex = secondRequest.messages.findIndex((message) => (
            message.role === 'assistant' && message.tool_calls?.some((call) => call.id === 'write-call')
        ))
        expect(assistantIndex).toBeGreaterThan(-1)
        expect(secondRequest.messages[assistantIndex + 1]).toMatchObject({
            role: 'tool',
            tool_call_id: 'write-call',
        })
        expect(secondRequest.messages[assistantIndex + 2]).toMatchObject({
            role: 'tool',
            tool_call_id: 'later-call',
        })
        expect(secondRequest.messages.at(-1)?.role).toBe('user')
    })

    it('replaces the pending tool result after confirmation', () => {
        const history = [
            {
                role: 'assistant' as const,
                content: null,
                tool_calls: [{
                    id: 'write-call',
                    type: 'function' as const,
                    function: { name: 'route_rule_add', arguments: '{}' },
                }],
            },
            {
                role: 'tool' as const,
                tool_call_id: 'write-call',
                content: JSON.stringify({ status: 'confirmation_required' }),
            },
        ]

        const completed = completeConfirmationInHistory(history, 'write-call', {
            status: 'executed',
            result: { status: 'success' },
        })

        expect(completed).toHaveLength(2)
        expect(completed[1]).toMatchObject({
            role: 'tool',
            tool_call_id: 'write-call',
            content: expect.stringContaining('"status":"executed"'),
        })
    })
})

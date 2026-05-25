import { previewRouteTarget } from '../../core/route-preview'
import { parseEprcWithExclusions, ruleMapToEprcText } from '../../helpers'
import {
    getActiveRuleFileNames,
    listRuleFiles,
    readRuleFileContent,
    writeRuleFileContent,
} from '../rule-files'
import type { AgentTool, AgentToolContext, AgentToolDefinition } from './types'

type ToolRegistry = Map<string, AgentTool>

interface RouteRuleAddInput extends Record<string, unknown> {
    ruleFile: string
    pattern: string
    target: string
    exclusions?: string[]
}

function asString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`缺少 ${field}`)
    }
    return value.trim()
}

function asStringArray(value: unknown): string[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error('exclusions 必须是字符串数组')
    return value.map((item) => asString(item, 'exclusion'))
}

function normalizeRoutePattern(pattern: string): { internalPattern: string; markerSuffix: string } {
    const marker = pattern.match(/\[([^\]]+)\]/)
    if (!marker) {
        return { internalPattern: pattern, markerSuffix: '' }
    }
    return {
        internalPattern: pattern.replace(marker[0], marker[1]),
        markerSuffix: marker[0],
    }
}

function normalizeRouteRuleAddInput(input: Record<string, unknown>): RouteRuleAddInput {
    return {
        ruleFile: asString(input.ruleFile, 'ruleFile'),
        pattern: asString(input.pattern, 'pattern'),
        target: asString(input.target, 'target'),
        exclusions: asStringArray(input.exclusions),
    }
}

function buildRouteRuleContent(input: RouteRuleAddInput, ctx: AgentToolContext) {
    const content = readRuleFileContent(ctx.serverContext, input.ruleFile)
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    const { internalPattern, markerSuffix } = normalizeRoutePattern(input.pattern)
    const previousTarget = ruleMap[internalPattern]
    ruleMap[internalPattern] = `${input.target}${markerSuffix}`
    excludeMap[internalPattern] = input.exclusions || []
    return {
        content,
        newContent: ruleMapToEprcText(ruleMap, excludeMap),
        internalPattern,
        previousTarget,
        newTarget: ruleMap[internalPattern],
        exclusions: excludeMap[internalPattern] || [],
    }
}

function buildRouteRuleDiff(input: RouteRuleAddInput, next: ReturnType<typeof buildRouteRuleContent>): string {
    const exclusions = next.exclusions.length ? ` !${next.exclusions.join(' !')}` : ''
    const previousLine = next.previousTarget
        ? `- ${next.internalPattern}${exclusions} ${next.previousTarget}`
        : null
    const nextLine = `+ ${next.internalPattern}${exclusions} ${next.newTarget}`
    return [
        `规则文件: ${input.ruleFile}`,
        previousLine,
        nextLine,
    ].filter(Boolean).join('\n')
}

function readCombinedActiveRules(ctx: AgentToolContext): string {
    const activeNames = getActiveRuleFileNames(ctx.serverContext)
    return activeNames
        .map((name) => readRuleFileContent(ctx.serverContext, name))
        .filter((content) => content.trim())
        .join('\n')
}

function createRouteRuleActiveGetTool(): AgentTool {
    return {
        name: 'route_rule_active_get',
        description: '查看当前启用的路由规则文件。用于决定写入哪个规则文件。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute(_input, ctx) {
            const files = listRuleFiles(ctx.serverContext)
            const activeFiles = files.filter((file) => file.enabled)
            return {
                activeRuleFiles: activeFiles.map((file) => file.name),
                activeCount: activeFiles.length,
                currentRuleFile: activeFiles.length === 1 ? activeFiles[0].name : null,
                files,
            }
        },
    }
}

function createRouteRuleListTool(): AgentTool {
    return {
        name: 'route_rule_list',
        description: '列出所有路由规则文件，或读取指定规则文件中的规则。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {
                ruleFile: {
                    type: 'string',
                    description: '可选的规则文件名，不含 .txt。',
                },
            },
            additionalProperties: false,
        },
        execute(input, ctx) {
            const ruleFile = typeof input.ruleFile === 'string' ? input.ruleFile.trim() : ''
            if (!ruleFile) {
                return { files: listRuleFiles(ctx.serverContext) }
            }
            const content = readRuleFileContent(ctx.serverContext, ruleFile)
            const parsed = parseEprcWithExclusions(content)
            return {
                ruleFile,
                rules: parsed.rules,
            }
        },
    }
}

function createRoutePreviewTool(): AgentTool {
    return {
        name: 'route_preview',
        description: '预览指定 URL 会被路由到哪里。支持指定 ruleFile 或传入 rulesText。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要预览的完整 URL。',
                },
                ruleFile: {
                    type: 'string',
                    description: '可选规则文件名，不传则使用全部启用规则文件。',
                },
                rulesText: {
                    type: 'string',
                    description: '可选临时规则文本；提供后优先使用。',
                },
            },
            required: ['url'],
            additionalProperties: false,
        },
        execute(input, ctx) {
            const url = asString(input.url, 'url')
            const rulesText = typeof input.rulesText === 'string' && input.rulesText.trim()
                ? input.rulesText
                : typeof input.ruleFile === 'string' && input.ruleFile.trim()
                    ? readRuleFileContent(ctx.serverContext, input.ruleFile)
                    : readCombinedActiveRules(ctx)
            if (!rulesText.trim()) {
                throw new Error('无可用规则：请先创建并激活路由规则文件，或提供 rulesText。')
            }
            return previewRouteTarget(url, rulesText)
        },
    }
}

function createRouteRuleAddTool(): AgentTool {
    return {
        name: 'route_rule_add',
        description: '在指定规则文件中添加或覆盖一条路由规则。该工具会修改本地规则配置，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                ruleFile: {
                    type: 'string',
                    description: '规则文件名，不含 .txt。',
                },
                pattern: {
                    type: 'string',
                    description: '匹配完整请求 URL 的 pattern，支持正则、通配符和 [marker]。',
                },
                target: {
                    type: 'string',
                    description: '转发目标。若仅 host:port 则继承原请求协议、路径和 query。',
                },
                exclusions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选排除规则列表。',
                },
            },
            required: ['ruleFile', 'pattern', 'target'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizeRouteRuleAddInput(input)
            const next = buildRouteRuleContent(normalized, ctx)
            const action = next.previousTarget ? '覆盖' : '添加'
            return {
                summary: `${action}路由规则：${normalized.pattern} -> ${normalized.target}`,
                diff: buildRouteRuleDiff(normalized, next),
                preview: {
                    ruleFile: normalized.ruleFile,
                    pattern: normalized.pattern,
                    target: normalized.target,
                    exclusions: normalized.exclusions || [],
                    overwritesExistingRule: Boolean(next.previousTarget),
                },
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeRouteRuleAddInput(input)
            const next = buildRouteRuleContent(normalized, ctx)
            writeRuleFileContent(ctx.serverContext, normalized.ruleFile, next.newContent)
            return {
                status: 'success',
                message: `已写入规则：${normalized.pattern} -> ${normalized.target}`,
                ruleFile: normalized.ruleFile,
                pattern: normalized.pattern,
                target: normalized.target,
                exclusions: normalized.exclusions || [],
            }
        },
    }
}

export function createAgentTools(): ToolRegistry {
    const tools = [
        createRouteRuleActiveGetTool(),
        createRouteRuleListTool(),
        createRoutePreviewTool(),
        createRouteRuleAddTool(),
    ]
    return new Map(tools.map((tool) => [tool.name, tool]))
}

export function toToolDefinitions(tools: ToolRegistry): AgentToolDefinition[] {
    return Array.from(tools.values()).map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }))
}

export function describeAgentTools(tools: ToolRegistry) {
    return Array.from(tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        requiresConfirmation: tool.requiresConfirmation,
        parameters: tool.parameters,
    }))
}

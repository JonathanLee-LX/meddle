import { previewRouteTarget } from '../../core/route-preview'
import { parseEprcWithExclusions, ruleMapToEprcText } from '../../helpers'
import {
    createRuleFile,
    getActiveRuleFileNames,
    listRuleFiles,
    readRuleFileContent,
    setActiveRuleFileNames,
    writeRuleFileContent,
} from '../rule-files'
import type { AgentTool, AgentToolContext, AgentToolDefinition } from './types'

type ToolRegistry = Map<string, AgentTool>

interface RouteRuleWriteInput extends Record<string, unknown> {
    ruleFile: string
    pattern: string
    target?: string
    exclusions?: string[]
}

interface RouteRuleRequiredTargetInput extends RouteRuleWriteInput {
    target: string
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

function normalizeRouteRuleAddInput(input: Record<string, unknown>): RouteRuleRequiredTargetInput {
    return {
        ruleFile: asString(input.ruleFile, 'ruleFile'),
        pattern: asString(input.pattern, 'pattern'),
        target: asString(input.target, 'target'),
        exclusions: asStringArray(input.exclusions),
    }
}

function normalizeRouteRuleUpdateInput(input: Record<string, unknown>): RouteRuleWriteInput {
    const targetValue = input.target ?? input.newTarget
    const target = targetValue === undefined ? undefined : asString(targetValue, 'target')
    const exclusions = input.exclusions === undefined ? undefined : asStringArray(input.exclusions)
    if (target === undefined && exclusions === undefined) {
        throw new Error('更新规则时必须提供 target/newTarget 或 exclusions')
    }
    return {
        ruleFile: asString(input.ruleFile, 'ruleFile'),
        pattern: asString(input.pattern, 'pattern'),
        target,
        exclusions,
    }
}

function normalizeRouteRuleDeleteInput(input: Record<string, unknown>): RouteRuleWriteInput {
    return {
        ruleFile: asString(input.ruleFile, 'ruleFile'),
        pattern: asString(input.pattern, 'pattern'),
    }
}

function formatRuleLine(pattern: string, target: string, exclusions: string[]): string {
    const exclusionText = exclusions.length ? ` !${exclusions.join(' !')}` : ''
    return `${pattern}${exclusionText} ${target}`
}

function buildRouteRuleAddContent(input: RouteRuleRequiredTargetInput, ctx: AgentToolContext) {
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
        previousExclusions: previousTarget ? excludeMap[internalPattern] || [] : [],
        newTarget: ruleMap[internalPattern],
        exclusions: excludeMap[internalPattern] || [],
    }
}

function buildRouteRuleUpdateContent(input: RouteRuleWriteInput, ctx: AgentToolContext) {
    const content = readRuleFileContent(ctx.serverContext, input.ruleFile)
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    const { internalPattern, markerSuffix } = normalizeRoutePattern(input.pattern)
    const previousTarget = ruleMap[internalPattern]
    if (!previousTarget) {
        throw new Error(`未找到路由规则: ${input.pattern}`)
    }

    const previousExclusions = excludeMap[internalPattern] || []
    const nextTarget = input.target ? `${input.target}${markerSuffix}` : previousTarget
    const nextExclusions = input.exclusions === undefined ? previousExclusions : input.exclusions
    ruleMap[internalPattern] = nextTarget
    excludeMap[internalPattern] = nextExclusions

    return {
        content,
        newContent: ruleMapToEprcText(ruleMap, excludeMap),
        internalPattern,
        previousTarget,
        previousExclusions,
        newTarget: nextTarget,
        exclusions: nextExclusions,
    }
}

function buildRouteRuleDeleteContent(input: RouteRuleWriteInput, ctx: AgentToolContext) {
    const content = readRuleFileContent(ctx.serverContext, input.ruleFile)
    const { ruleMap, excludeMap } = parseEprcWithExclusions(content)
    const { internalPattern } = normalizeRoutePattern(input.pattern)
    const previousTarget = ruleMap[internalPattern]
    if (!previousTarget) {
        throw new Error(`未找到路由规则: ${input.pattern}`)
    }

    const previousExclusions = excludeMap[internalPattern] || []
    delete ruleMap[internalPattern]
    delete excludeMap[internalPattern]

    return {
        content,
        newContent: ruleMapToEprcText(ruleMap, excludeMap),
        internalPattern,
        previousTarget,
        previousExclusions,
    }
}

function buildRouteRuleDiff(input: RouteRuleRequiredTargetInput, next: ReturnType<typeof buildRouteRuleAddContent>): string {
    const previousLine = next.previousTarget
        ? `- ${formatRuleLine(next.internalPattern, next.previousTarget, next.previousExclusions)}`
        : null
    const nextLine = `+ ${formatRuleLine(next.internalPattern, next.newTarget, next.exclusions)}`
    return [
        `规则文件: ${input.ruleFile}`,
        previousLine,
        nextLine,
    ].filter(Boolean).join('\n')
}

function buildRouteRuleUpdateDiff(input: RouteRuleWriteInput, next: ReturnType<typeof buildRouteRuleUpdateContent>): string {
    return [
        `规则文件: ${input.ruleFile}`,
        `- ${formatRuleLine(next.internalPattern, next.previousTarget, next.previousExclusions)}`,
        `+ ${formatRuleLine(next.internalPattern, next.newTarget, next.exclusions)}`,
    ].join('\n')
}

function buildRouteRuleDeleteDiff(input: RouteRuleWriteInput, next: ReturnType<typeof buildRouteRuleDeleteContent>): string {
    return [
        `规则文件: ${input.ruleFile}`,
        `- ${formatRuleLine(next.internalPattern, next.previousTarget, next.previousExclusions)}`,
    ].join('\n')
}

function normalizeRouteRuleCreateFileInput(input: Record<string, unknown>) {
    const rawName = input.ruleFile ?? input.name
    const enabled = input.enabled === undefined ? true : input.enabled === true
    return {
        name: asString(rawName, 'ruleFile'),
        content: typeof input.content === 'string' ? input.content : '',
        enabled,
    }
}

function normalizeRouteRuleActiveSetInput(input: Record<string, unknown>) {
    if (Array.isArray(input.ruleFiles)) {
        return { ruleFiles: input.ruleFiles.map((item) => asString(item, 'ruleFile')) }
    }
    return { ruleFiles: [asString(input.ruleFile, 'ruleFile')] }
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
            const next = buildRouteRuleAddContent(normalized, ctx)
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
            const next = buildRouteRuleAddContent(normalized, ctx)
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

function createRouteRuleUpdateTool(): AgentTool {
    return {
        name: 'route_rule_update',
        description: '更新指定规则文件中的路由规则 target 和/或 exclusions。该工具会修改本地规则配置，执行前必须确认。',
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
                    description: '要更新的现有路由规则 pattern，支持带 [marker] 的写法。',
                },
                target: {
                    type: 'string',
                    description: '新的转发目标。也兼容 newTarget 字段。',
                },
                newTarget: {
                    type: 'string',
                    description: '新的转发目标，兼容 MCP 工具命名。',
                },
                exclusions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '新的排除规则列表；传空数组表示清空。',
                },
            },
            required: ['ruleFile', 'pattern'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizeRouteRuleUpdateInput(input)
            const next = buildRouteRuleUpdateContent(normalized, ctx)
            return {
                summary: `更新路由规则：${normalized.pattern}`,
                diff: buildRouteRuleUpdateDiff(normalized, next),
                preview: {
                    ruleFile: normalized.ruleFile,
                    pattern: normalized.pattern,
                    target: next.newTarget,
                    exclusions: next.exclusions,
                },
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeRouteRuleUpdateInput(input)
            const next = buildRouteRuleUpdateContent(normalized, ctx)
            writeRuleFileContent(ctx.serverContext, normalized.ruleFile, next.newContent)
            return {
                status: 'success',
                message: `已更新规则：${normalized.pattern}`,
                ruleFile: normalized.ruleFile,
                pattern: normalized.pattern,
                target: next.newTarget,
                exclusions: next.exclusions,
            }
        },
    }
}

function createRouteRuleDeleteTool(): AgentTool {
    return {
        name: 'route_rule_delete',
        description: '删除指定规则文件中的一条路由规则。该工具会修改本地规则配置，执行前必须确认。',
        risk: 'destructive',
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
                    description: '要删除的现有路由规则 pattern，支持带 [marker] 的写法。',
                },
            },
            required: ['ruleFile', 'pattern'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizeRouteRuleDeleteInput(input)
            const next = buildRouteRuleDeleteContent(normalized, ctx)
            return {
                summary: `删除路由规则：${normalized.pattern}`,
                diff: buildRouteRuleDeleteDiff(normalized, next),
                preview: {
                    ruleFile: normalized.ruleFile,
                    pattern: normalized.pattern,
                    target: next.previousTarget,
                    exclusions: next.previousExclusions,
                },
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeRouteRuleDeleteInput(input)
            const next = buildRouteRuleDeleteContent(normalized, ctx)
            writeRuleFileContent(ctx.serverContext, normalized.ruleFile, next.newContent)
            return {
                status: 'success',
                message: `已删除规则：${normalized.pattern}`,
                ruleFile: normalized.ruleFile,
                pattern: normalized.pattern,
            }
        },
    }
}

function createRouteRuleCreateFileTool(): AgentTool {
    return {
        name: 'route_rule_create_file',
        description: '创建新的路由规则文件，并可选择是否设为启用。该工具会修改本地规则配置，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                ruleFile: {
                    type: 'string',
                    description: '要创建的规则文件名，不含 .txt。也兼容 name 字段。',
                },
                name: {
                    type: 'string',
                    description: '要创建的规则文件名，不含 .txt。',
                },
                content: {
                    type: 'string',
                    description: '可选初始规则文本。',
                },
                enabled: {
                    type: 'boolean',
                    description: '是否创建后启用，默认 true。',
                },
            },
            additionalProperties: false,
        },
        prepareConfirmation(input) {
            const normalized = normalizeRouteRuleCreateFileInput(input)
            return {
                summary: `创建规则文件：${normalized.name}${normalized.enabled ? '，并启用' : ''}`,
                diff: [
                    `+ 规则文件: ${normalized.name}`,
                    normalized.content ? `+ 初始内容:\n${normalized.content}` : null,
                ].filter(Boolean).join('\n'),
                preview: normalized,
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeRouteRuleCreateFileInput(input)
            const ruleFile = createRuleFile(ctx.serverContext, normalized.name, normalized.content, normalized.enabled)
            return {
                status: 'success',
                message: `已创建规则文件：${ruleFile.name}`,
                ruleFile,
            }
        },
    }
}

function createRouteRuleActiveSetTool(): AgentTool {
    return {
        name: 'route_rule_active_set',
        description: '设置当前启用的路由规则文件列表。传 ruleFile 可设置单个启用文件，传 ruleFiles 可按顺序启用多个文件。执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                ruleFile: {
                    type: 'string',
                    description: '单个要启用的规则文件名，不含 .txt。',
                },
                ruleFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '按顺序启用的规则文件名列表，不含 .txt。',
                },
            },
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizeRouteRuleActiveSetInput(input)
            const current = getActiveRuleFileNames(ctx.serverContext)
            return {
                summary: `切换启用规则文件：${normalized.ruleFiles.join(', ')}`,
                diff: [
                    `- 当前启用: ${current.join(', ') || '(无)'}`,
                    `+ 新启用: ${normalized.ruleFiles.join(', ') || '(无)'}`,
                ].join('\n'),
                preview: normalized,
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeRouteRuleActiveSetInput(input)
            const activeRuleFiles = setActiveRuleFileNames(ctx.serverContext, normalized.ruleFiles)
            return {
                status: 'success',
                message: `已切换启用规则文件：${activeRuleFiles.join(', ')}`,
                activeRuleFiles,
            }
        },
    }
}

export function createAgentTools(): ToolRegistry {
    const tools = [
        createRouteRuleActiveGetTool(),
        createRouteRuleListTool(),
        createRoutePreviewTool(),
        createRouteRuleCreateFileTool(),
        createRouteRuleActiveSetTool(),
        createRouteRuleAddTool(),
        createRouteRuleUpdateTool(),
        createRouteRuleDeleteTool(),
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

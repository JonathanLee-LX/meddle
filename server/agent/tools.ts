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
import { refreshConfig } from '../config'
import { createMockRule, deleteMockRule, updateMockRule, type MockRule, type MockRuleInput } from '../mocks'
import { reloadPlugins, setPluginEnabled } from '../plugins'
import { normalizePipelineMode, resetShadowStats, setPipelineMode, type PipelineMode } from '../pipeline'
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

function asOptionalNumber(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) {
        throw new Error(`${field} 必须是数字`)
    }
    return parsed
}

function asOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined) return undefined
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error('enabled 必须是布尔值')
}

function asHeaders(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('headers 必须是对象')
    }
    const headers: Record<string, string> = {}
    for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof headerValue !== 'string') {
            throw new Error(`header ${key} 必须是字符串`)
        }
        headers[key] = headerValue
    }
    return headers
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

function normalizeMockRuleId(input: Record<string, unknown>): number {
    const id = asOptionalNumber(input.id, 'id')
    if (id === undefined) {
        throw new Error('缺少 id')
    }
    return id
}

function normalizeMockRuleInput(input: Record<string, unknown>, requirePattern: boolean): MockRuleInput {
    const bodyTypeValue = input.bodyType
    const bodyType = bodyTypeValue === undefined ? undefined : asString(bodyTypeValue, 'bodyType')
    if (bodyType !== undefined && bodyType !== 'inline' && bodyType !== 'file') {
        throw new Error('bodyType 仅支持 inline 或 file')
    }

    const data: MockRuleInput = {}
    if (input.name !== undefined) data.name = asString(input.name, 'name')
    if (input.urlPattern !== undefined) data.urlPattern = asString(input.urlPattern, 'urlPattern')
    if (input.method !== undefined) data.method = asString(input.method, 'method').toUpperCase()
    if (input.statusCode !== undefined) data.statusCode = asOptionalNumber(input.statusCode, 'statusCode')
    if (input.delay !== undefined) data.delay = asOptionalNumber(input.delay, 'delay')
    if (bodyType !== undefined) data.bodyType = bodyType
    if (input.headers !== undefined) data.headers = asHeaders(input.headers)
    if (input.body !== undefined) data.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
    if (input.enabled !== undefined) data.enabled = asOptionalBoolean(input.enabled)

    if (requirePattern && !data.urlPattern) {
        throw new Error('缺少 urlPattern')
    }
    return data
}

function getMockRule(ctx: AgentToolContext, id: number): MockRule {
    const rule = ctx.serverContext.mockRules.find((item) => item.id === id)
    if (!rule) {
        throw new Error(`未找到 Mock 规则: ${id}`)
    }
    return rule
}

function formatMockRule(rule: MockRule): string {
    return [
        `id=${rule.id}`,
        `name=${rule.name || '(未命名)'}`,
        `method=${rule.method || '*'}`,
        `pattern=${rule.urlPattern}`,
        `status=${rule.statusCode}`,
        `enabled=${rule.enabled}`,
    ].join(' ')
}

function buildMockRuleDiff(previous: MockRule | null, next: MockRuleInput & { id?: number }): string {
    return [
        previous ? `- ${formatMockRule(previous)}` : null,
        `+ ${[
            next.id !== undefined ? `id=${next.id}` : null,
            `name=${next.name || '(未命名)'}`,
            `method=${next.method || '*'}`,
            `pattern=${next.urlPattern || ''}`,
            `status=${next.statusCode || 200}`,
            `enabled=${next.enabled !== false}`,
        ].filter(Boolean).join(' ')}`,
    ].filter(Boolean).join('\n')
}

function normalizeLogListInput(input: Record<string, unknown>) {
    const limit = asOptionalNumber(input.limit, 'limit') ?? 20
    const method = typeof input.method === 'string' && input.method.trim() ? input.method.trim().toUpperCase() : null
    const keyword = typeof input.keyword === 'string' && input.keyword.trim() ? input.keyword.trim() : null
    const statusCode = asOptionalNumber(input.statusCode, 'statusCode')
    return {
        limit: Math.min(100, Math.max(1, Math.floor(limit))),
        method,
        keyword,
        statusCode,
    }
}

function normalizePipelineModeInput(input: Record<string, unknown>): { mode: PipelineMode } {
    const mode = normalizePipelineMode(input.mode)
    if (!mode) {
        throw new Error('mode 必须是 off、shadow 或 on')
    }
    return { mode }
}

function normalizePluginToggleInput(input: Record<string, unknown>): { pluginId: string; enabled: boolean } {
    const pluginId = asString(input.pluginId ?? input.id, 'pluginId')
    const enabled = asOptionalBoolean(input.enabled)
    if (enabled === undefined) {
        throw new Error('缺少 enabled')
    }
    return { pluginId, enabled }
}

function getPluginState(ctx: AgentToolContext, pluginId: string): string {
    const plugin = ctx.serverContext.pluginManager.getAll().find((item) => item.manifest.id === pluginId)
    if (!plugin) {
        throw new Error(`未找到插件: ${pluginId}`)
    }
    return ctx.serverContext.pluginManager.getState(pluginId)
}

function buildPluginList(ctx: AgentToolContext) {
    const pluginStats = ctx.serverContext.hookDispatcher.getPluginStats ? ctx.serverContext.hookDispatcher.getPluginStats() : {}
    const plugins = ctx.serverContext.pluginManager.getAll().map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        hooks: plugin.manifest.hooks,
        permissions: plugin.manifest.permissions,
        priority: plugin.manifest.priority,
        state: ctx.serverContext.pluginManager.getState(plugin.manifest.id),
        stats: pluginStats[plugin.manifest.id] || null,
    }))
    return {
        mode: ctx.serverContext.requestPipeline.mode,
        total: plugins.length,
        plugins,
    }
}

function buildPipelineStatus(ctx: AgentToolContext) {
    return {
        mode: ctx.serverContext.requestPipeline.mode,
        shadowStats: ctx.serverContext.shadowCompareTracker.getStats(),
        onModeGate: ctx.serverContext.onModeGate.getStats(),
    }
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

function createMockRuleListTool(): AgentTool {
    return {
        name: 'mock_rule_list',
        description: '列出所有 Mock 规则，或按 id 查看单条 Mock 规则。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'number',
                    description: '可选 Mock 规则 ID。',
                },
            },
            additionalProperties: false,
        },
        execute(input, ctx) {
            const id = asOptionalNumber(input.id, 'id')
            if (id !== undefined) {
                return { rule: getMockRule(ctx, id) }
            }
            return { rules: ctx.serverContext.mockRules }
        },
    }
}

function createMockRuleAddTool(): AgentTool {
    return {
        name: 'mock_rule_add',
        description: '新增 Mock 规则。该工具会修改本地 Mock 配置，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '规则名称。' },
                urlPattern: { type: 'string', description: 'URL 匹配正则或字符串。' },
                method: { type: 'string', description: 'HTTP 方法，如 GET、POST、*。默认 *。' },
                statusCode: { type: 'number', description: '响应状态码，默认 200。' },
                delay: { type: 'number', description: '延迟毫秒数，默认 0。' },
                bodyType: { type: 'string', description: 'body 类型：inline 或 file。默认 inline。' },
                headers: { type: 'object', additionalProperties: { type: 'string' }, description: '响应头。' },
                body: { type: 'string', description: '响应体内容。' },
                enabled: { type: 'boolean', description: '是否启用，默认 true。' },
            },
            required: ['urlPattern'],
            additionalProperties: false,
        },
        prepareConfirmation(input) {
            const normalized = normalizeMockRuleInput(input, true)
            return {
                summary: `新增 Mock 规则：${normalized.name || normalized.urlPattern}`,
                diff: buildMockRuleDiff(null, normalized),
                preview: normalized,
                input: normalized as Record<string, unknown>,
            }
        },
        execute(input, ctx) {
            const normalized = normalizeMockRuleInput(input, true)
            const rule = createMockRule(ctx.serverContext, normalized)
            return {
                status: 'success',
                message: `已新增 Mock 规则：${rule.name || rule.urlPattern}`,
                rule,
            }
        },
    }
}

function createMockRuleUpdateTool(): AgentTool {
    return {
        name: 'mock_rule_update',
        description: '更新指定 Mock 规则。该工具会修改本地 Mock 配置，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'number', description: '要更新的 Mock 规则 ID。' },
                name: { type: 'string', description: '规则名称。' },
                urlPattern: { type: 'string', description: 'URL 匹配正则或字符串。' },
                method: { type: 'string', description: 'HTTP 方法，如 GET、POST、*。' },
                statusCode: { type: 'number', description: '响应状态码。' },
                delay: { type: 'number', description: '延迟毫秒数。' },
                bodyType: { type: 'string', description: 'body 类型：inline 或 file。' },
                headers: { type: 'object', additionalProperties: { type: 'string' }, description: '响应头。' },
                body: { type: 'string', description: '响应体内容。' },
                enabled: { type: 'boolean', description: '是否启用。' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const id = normalizeMockRuleId(input)
            const previous = getMockRule(ctx, id)
            const patch = normalizeMockRuleInput(input, false)
            const next = { ...previous, ...patch, id }
            return {
                summary: `更新 Mock 规则：${previous.name || previous.urlPattern}`,
                diff: buildMockRuleDiff(previous, next),
                preview: next,
                input: { id, ...patch },
            }
        },
        execute(input, ctx) {
            const id = normalizeMockRuleId(input)
            const patch = normalizeMockRuleInput(input, false)
            const rule = updateMockRule(ctx.serverContext, id, patch)
            return {
                status: 'success',
                message: `已更新 Mock 规则：${rule.name || rule.urlPattern}`,
                rule,
            }
        },
    }
}

function createMockRuleDeleteTool(): AgentTool {
    return {
        name: 'mock_rule_delete',
        description: '删除指定 Mock 规则。该工具会修改本地 Mock 配置，执行前必须确认。',
        risk: 'destructive',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'number', description: '要删除的 Mock 规则 ID。' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const id = normalizeMockRuleId(input)
            const previous = getMockRule(ctx, id)
            return {
                summary: `删除 Mock 规则：${previous.name || previous.urlPattern}`,
                diff: `- ${formatMockRule(previous)}`,
                preview: previous,
                input: { id },
            }
        },
        execute(input, ctx) {
            const id = normalizeMockRuleId(input)
            const previous = getMockRule(ctx, id)
            deleteMockRule(ctx.serverContext, id)
            return {
                status: 'success',
                message: `已删除 Mock 规则：${previous.name || previous.urlPattern}`,
                id,
            }
        },
    }
}

function createLogListTool(): AgentTool {
    return {
        name: 'log_list',
        description: '查看最近的代理请求日志，可按 method、statusCode 或关键词过滤。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回数量，默认 20，最大 100。' },
                method: { type: 'string', description: '可选 HTTP 方法过滤。' },
                statusCode: { type: 'number', description: '可选状态码过滤。' },
                keyword: { type: 'string', description: '可选关键词，匹配源地址或目标地址。' },
            },
            additionalProperties: false,
        },
        execute(input, ctx) {
            const normalized = normalizeLogListInput(input)
            const records = [...ctx.serverContext.proxyRecordArr].reverse()
                .filter((record) => !normalized.method || record.method.toUpperCase() === normalized.method)
                .filter((record) => normalized.statusCode === undefined || record.statusCode === normalized.statusCode)
                .filter((record) => {
                    if (!normalized.keyword) return true
                    return record.source.includes(normalized.keyword) || record.target.includes(normalized.keyword)
                })
                .slice(0, normalized.limit)
            return {
                total: ctx.serverContext.proxyRecordArr.length,
                returned: records.length,
                records,
            }
        },
    }
}

function createLogDetailTool(): AgentTool {
    return {
        name: 'log_detail_get',
        description: '按日志 ID 查看请求详情，包括请求头、响应头、body 摘要和状态码。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'number', description: '日志记录 ID。' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        execute(input, ctx) {
            const id = normalizeMockRuleId(input)
            const detail = ctx.serverContext.proxyRecordDetailMap.get(id)
            const record = ctx.serverContext.proxyRecordArr.find((item) => item.id === id)
            if (!detail && !record) {
                throw new Error(`未找到日志记录: ${id}`)
            }
            return {
                record,
                detail: detail || null,
            }
        },
    }
}

function createPluginListTool(): AgentTool {
    return {
        name: 'plugin_list',
        description: '查看当前插件列表、状态、hooks、权限和执行统计。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute(_input, ctx) {
            return buildPluginList(ctx)
        },
    }
}

function createPluginHealthTool(): AgentTool {
    return {
        name: 'plugin_health_get',
        description: '查看插件健康概览，包括插件状态和 hook 统计。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute(_input, ctx) {
            const pluginStats = ctx.serverContext.hookDispatcher.getPluginStats ? ctx.serverContext.hookDispatcher.getPluginStats() : {}
            const pluginStates: Record<string, string> = {}
            const plugins = ctx.serverContext.pluginManager.getAll().map((plugin) => {
                pluginStates[plugin.manifest.id] = ctx.serverContext.pluginManager.getState(plugin.manifest.id)
                return {
                    id: plugin.manifest.id,
                    name: plugin.manifest.name,
                    version: plugin.manifest.version,
                    hooks: plugin.manifest.hooks,
                    permissions: plugin.manifest.permissions,
                    priority: plugin.manifest.priority,
                }
            })
            return {
                mode: ctx.serverContext.requestPipeline.mode,
                total: plugins.length,
                plugins,
                pluginStates,
                pluginStats,
            }
        },
    }
}

function createPluginToggleTool(): AgentTool {
    return {
        name: 'plugin_toggle',
        description: '启用或禁用指定插件。该工具会修改运行态和 settings.json，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                pluginId: { type: 'string', description: '插件 ID。也兼容 id 字段。' },
                id: { type: 'string', description: '插件 ID，兼容简写。' },
                enabled: { type: 'boolean', description: 'true 表示启用，false 表示禁用。' },
            },
            required: ['enabled'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizePluginToggleInput(input)
            const currentState = getPluginState(ctx, normalized.pluginId)
            const nextState = normalized.enabled ? 'running' : 'disabled'
            return {
                summary: `${normalized.enabled ? '启用' : '禁用'}插件：${normalized.pluginId}`,
                diff: [
                    `- ${normalized.pluginId}: state=${currentState}`,
                    `+ ${normalized.pluginId}: state=${nextState}`,
                ].join('\n'),
                preview: {
                    pluginId: normalized.pluginId,
                    currentState,
                    nextState,
                },
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizePluginToggleInput(input)
            return setPluginEnabled(ctx.serverContext, normalized.pluginId, normalized.enabled)
        },
    }
}

function createPluginReloadTool(): AgentTool {
    return {
        name: 'plugin_reload',
        description: '热加载自定义插件。该工具会重新扫描并注册本地插件，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        prepareConfirmation() {
            return {
                summary: '热加载自定义插件',
                diff: [
                    '- 当前自定义插件注册状态',
                    '+ 重新扫描并加载自定义插件',
                ].join('\n'),
                preview: {},
                input: {},
            }
        },
        execute(_input, ctx) {
            return reloadPlugins(ctx.serverContext)
        },
    }
}

function createPipelineStatusTool(): AgentTool {
    return {
        name: 'pipeline_status_get',
        description: '查看 request pipeline 当前模式、shadow 统计和 on-mode gate 统计。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute(_input, ctx) {
            return buildPipelineStatus(ctx)
        },
    }
}

function createPipelineShadowStatsResetTool(): AgentTool {
    return {
        name: 'pipeline_shadow_stats_reset',
        description: '重置 request pipeline 的 shadow 比对统计和 on-mode gate 统计。执行前必须确认。',
        risk: 'destructive',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        prepareConfirmation(_input, ctx) {
            return {
                summary: '重置 shadow 统计',
                diff: [
                    `- shadowStats=${JSON.stringify(ctx.serverContext.shadowCompareTracker.getStats())}`,
                    `- onModeGate=${JSON.stringify(ctx.serverContext.onModeGate.getStats())}`,
                    '+ shadowStats=reset',
                    '+ onModeGate=reset',
                ].join('\n'),
                preview: buildPipelineStatus(ctx),
                input: {},
            }
        },
        execute(_input, ctx) {
            return resetShadowStats(ctx.serverContext)
        },
    }
}

function createPipelineModeSetTool(): AgentTool {
    return {
        name: 'pipeline_mode_set',
        description: '切换插件 request pipeline 模式，可选 off、shadow、on。该工具会修改运行态和 settings.json，执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {
                mode: { type: 'string', description: '目标模式：off、shadow 或 on。' },
            },
            required: ['mode'],
            additionalProperties: false,
        },
        prepareConfirmation(input, ctx) {
            const normalized = normalizePipelineModeInput(input)
            const current = ctx.serverContext.requestPipeline.mode
            return {
                summary: `切换插件模式：${current} -> ${normalized.mode}`,
                diff: [
                    `- pluginMode=${current}`,
                    `+ pluginMode=${normalized.mode}`,
                ].join('\n'),
                preview: {
                    currentMode: current,
                    nextMode: normalized.mode,
                },
                input: normalized,
            }
        },
        execute(input, ctx) {
            const normalized = normalizePipelineModeInput(input)
            return setPipelineMode(ctx.serverContext, normalized.mode)
        },
    }
}

function createConfigRefreshTool(): AgentTool {
    return {
        name: 'config_refresh',
        description: '刷新本地配置，重新加载路由规则和 Mock 规则。执行前必须确认。',
        risk: 'write',
        requiresConfirmation: true,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        prepareConfirmation(_input, ctx) {
            return {
                summary: '刷新配置',
                diff: [
                    '- 当前内存中的规则和 Mock 配置',
                    '+ 从本地配置文件重新加载规则和 Mock 配置',
                ].join('\n'),
                preview: {
                    mocksPath: ctx.serverContext.getMockFilePath(),
                },
                input: {},
            }
        },
        execute(_input, ctx) {
            return refreshConfig(ctx.serverContext)
        },
    }
}

function createConfigDoctorTool(): AgentTool {
    return {
        name: 'config_doctor',
        description: '运行配置文件健康检查，查看规则、Mock、插件等配置状态。',
        risk: 'read',
        requiresConfirmation: false,
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute(_input, ctx) {
            return ctx.serverContext.performConfigDiagnostics()
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
        createMockRuleListTool(),
        createMockRuleAddTool(),
        createMockRuleUpdateTool(),
        createMockRuleDeleteTool(),
        createLogListTool(),
        createLogDetailTool(),
        createPluginListTool(),
        createPluginHealthTool(),
        createPluginToggleTool(),
        createPluginReloadTool(),
        createPipelineStatusTool(),
        createPipelineShadowStatsResetTool(),
        createPipelineModeSetTool(),
        createConfigRefreshTool(),
        createConfigDoctorTool(),
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

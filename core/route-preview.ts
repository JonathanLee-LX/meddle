import type { RouteRuleEntry } from '../helpers'
import { parseEprcWithExclusions, findMatchedRouteRule, testRulePattern } from '../helpers'

export type RouteTargetKind = 'empty' | 'file' | 'absolute-url' | 'host'

export interface RoutePreviewMatchedRule {
    pattern: string
    target: string
    kind: RouteTargetKind
}

export interface RoutePreviewResult {
    inputUrl: string
    matched: boolean
    resolvedUrl: string
    matchedRule?: RoutePreviewMatchedRule
    notes: string[]
}

function getTargetKind(target: string): RouteTargetKind {
    const trimmed = target.trim()
    if (!trimmed) return 'empty'
    if (/^file:\/\//i.test(trimmed) || /^[A-Za-z]:\\|^\//.test(trimmed)) return 'file'
    if (/^(https?|wss?):\/\//i.test(trimmed)) return 'absolute-url'
    return 'host'
}

function buildNotes(kind: RouteTargetKind, target: string, resolvedUrl: string, inputUrl: string): string[] {
    const notes: string[] = []

    if (resolvedUrl === inputUrl) {
        notes.push('未命中规则，保持原 URL')
        return notes
    }

    switch (kind) {
        case 'file':
            notes.push('命中本地文件目标')
            break
        case 'absolute-url':
            notes.push('使用完整目标地址')
            break
        case 'host':
            notes.push('继承原请求协议、路径和 query')
            break
        case 'empty':
            notes.push('规则目标为空')
            break
    }

    if (/\[[^\]]+\]/.test(target)) {
        notes.push('保留 marker 尾缀')
    }

    return notes
}

function findMatchedPattern(inputUrl: string, rules: RouteRuleEntry[]): { pattern: string; target: string } | null {
    for (const entry of rules) {
        let matched = false
        try {
            matched = testRulePattern(entry.pattern, inputUrl)
        } catch (err) {
            throw new Error(`规则 "${entry.pattern}" 是无效的正则表达式: ${(err as Error).message}`)
        }

        if (matched) {
            if (entry.exclusions.some((exc) => testRulePattern(exc, inputUrl))) {
                continue
            }
            return { pattern: entry.pattern, target: entry.target }
        }
    }

    return null
}

export function previewRouteTarget(inputUrl: string, rulesText: string): RoutePreviewResult {
    let parsedUrl: URL
    try {
        parsedUrl = new URL(inputUrl)
    } catch {
        throw new Error('请输入合法的 URL')
    }

    const { rules } = parseEprcWithExclusions(rulesText)
    const matchedRule = findMatchedPattern(parsedUrl.toString(), rules)
    const matched = findMatchedRouteRule(parsedUrl.toString(), rules)

    if (!matchedRule || !matched) {
        return {
            inputUrl: parsedUrl.toString(),
            matched: false,
            resolvedUrl: parsedUrl.toString(),
            notes: ['未命中规则，保持原 URL'],
        }
    }

    const resolvedUrl = matched.resolvedUrl
    const kind = getTargetKind(matchedRule.target)

    return {
        inputUrl: parsedUrl.toString(),
        matched: true,
        resolvedUrl,
        matchedRule: {
            pattern: matchedRule.pattern,
            target: matchedRule.target,
            kind,
        },
        notes: buildNotes(kind, matchedRule.target, resolvedUrl, parsedUrl.toString()),
    }
}

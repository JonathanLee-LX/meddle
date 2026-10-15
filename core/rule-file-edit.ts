/**
 * Line-preserving edits of route rule files (issue #145).
 *
 * The old write path parsed a rule file into a ruleMap and rebuilt the whole
 * text, which dropped comments, blank lines and disabled (`//`) rules. These
 * helpers edit only the lines that hold the target pattern; every other line
 * keeps its exact bytes (including its line ending).
 *
 * Kept in sync with bin/lib/rule-file-edit.js (same convention as
 * core/meddle-home.ts ↔ bin/lib/meddle-home.js). The JS copy exists so the CLI
 * and the MCP server do not depend on the compiled dist/ output.
 */

const MARKER = /\[([^\]]+)\]/
const BOM = '\uFEFF'
export const SPLIT_UNSAFE_MESSAGE = '该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改'

/**
 * Thrown when splitting a line or removing a pattern would put a pattern that
 * starts with `//` or `#` at the start of a line, turning it into a disabled
 * rule or a comment. The rule file is left untouched.
 */
export class RuleLineSplitError extends Error {
    readonly code = 'RULE_LINE_SPLIT_UNSAFE'

    constructor() {
        super(SPLIT_UNSAFE_MESSAGE)
        this.name = 'RuleLineSplitError'
    }
}

export const NEW_RULE_COMMENT_MESSAGE = '规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。'

/**
 * Thrown when a NEW rule's pattern starts with `//` or `#`: appended as a line it
 * would read back as a disabled rule or a comment. Same code as RuleLineSplitError.
 */
export class RuleNewRuleCommentError extends Error {
    readonly code = 'RULE_LINE_SPLIT_UNSAFE'

    constructor() {
        super(NEW_RULE_COMMENT_MESSAGE)
        this.name = 'RuleNewRuleCommentError'
    }
}

function startsAsComment(pattern: string): boolean {
    return pattern.startsWith('//') || pattern.startsWith('#')
}

/**
 * A leading UTF-8 BOM is not part of the first line: strip it before editing
 * and put it back afterwards, so it stays byte-identical even when the first
 * line is split or deleted (JS `trim()` / `\s` treat U+FEFF as whitespace).
 */
function withBom<T extends { content: string }>(content: string, edit: (text: string) => T): T {
    if (!content.startsWith(BOM)) return edit(content)
    const result = edit(content.slice(BOM.length))
    return { ...result, content: BOM + result.content }
}

export interface RouteRuleEdit {
    pattern: string
    target?: string
    /** `undefined` keeps each edited line's own exclusions. */
    exclusions?: string[]
}

interface ParsedRuleLine {
    leading: string
    patterns: string[]
    target: string
    exclusions: string[]
}

/** Internal key of a pattern token: `[marker]` brackets removed (same as the parser). */
export function patternKey(token: string): string {
    const bm = token.match(MARKER)
    return bm ? token.replace(bm[0], bm[1]) : token
}

/** Split into [line, eol, line, eol, ..., line]; the parser splits on /\r?\n/ too. */
function splitLines(content: string): string[] {
    return content.split(/(\r?\n)/)
}

/**
 * Parse one line the way parseEprcWithExclusions does. Returns null for blank
 * lines, `#` comments, `//` disabled rules and lines that are not rules.
 */
export function parseRuleLine(line: string): ParsedRuleLine | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null
    const parts = trimmed.split(/\s+/).filter(Boolean)
    const exclusionTokens = parts.filter((p) => p.startsWith('!'))
    const regular = parts.filter((p) => !p.startsWith('!'))
    if (regular.length < 2) return null
    return {
        leading: (line.match(/^\s*/) || [''])[0],
        patterns: regular.slice(0, -1),
        target: regular[regular.length - 1],
        exclusions: exclusionTokens.map((t) => t.slice(1)),
    }
}

function formatLine(leading: string, patterns: string[], exclusions: string[], target: string): string {
    const parts = patterns.slice()
    for (const e of exclusions) parts.push(`!${e}`)
    parts.push(target)
    return `${leading}${parts.join(' ')}`
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Replace the last regular (target) token in place, keeping all spacing. */
function replaceTargetInPlace(line: string, target: string): string {
    const tokens = line.match(/\s+|\S+/g) || []
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (/\S/.test(tokens[i]) && !tokens[i].startsWith('!')) {
            tokens[i] = target
            return tokens.join('')
        }
    }
    return line
}

/** Remove the pattern tokens whose key is in `keys` (and one adjacent separator each). */
function removePatternTokens(line: string, keys: Set<string>): string {
    const tokens = line.match(/\s+|\S+/g) || []
    const nonSpace: number[] = []
    tokens.forEach((t, i) => { if (/\S/.test(t)) nonSpace.push(i) })
    const regularIdx = nonSpace.filter((i) => !tokens[i].startsWith('!'))
    const patternIdx = regularIdx.slice(0, -1)
    const drop = new Set<number>()
    for (const i of patternIdx) {
        if (!keys.has(patternKey(tokens[i]))) continue
        drop.add(i)
        // Prefer the separator after the token (a pattern is never the last token).
        if (i + 1 < tokens.length && !/\S/.test(tokens[i + 1]) && !drop.has(i + 1)) drop.add(i + 1)
        else if (i - 1 > 0 && !/\S/.test(tokens[i - 1])) drop.add(i - 1)
    }
    return tokens.filter((_, i) => !drop.has(i)).join('')
}

/**
 * Point every enabled occurrence of `pattern` at `target` (if given) and/or set
 * its exclusions (if given; `undefined` keeps each line's own exclusions).
 * Lines that do not contain the pattern are left untouched.
 */
export function updateRouteRule(content: string, edit: RouteRuleEdit): { content: string; found: boolean } {
    return withBom(content, (text) => updateLines(text, edit))
}

function updateLines(content: string, edit: RouteRuleEdit): { content: string; found: boolean } {
    const { pattern, target, exclusions } = edit
    const key = patternKey(pattern)
    const userHasMarker = MARKER.test(pattern)
    const segments = splitLines(content)
    let found = false

    for (let s = 0; s < segments.length; s += 2) {
        const line = segments[s]
        const parsed = parseRuleLine(line)
        if (!parsed || !parsed.patterns.some((p) => patternKey(p) === key)) continue
        found = true

        const nextTarget = target !== undefined ? target : parsed.target
        const nextExclusions = exclusions !== undefined ? exclusions : parsed.exclusions
        const exclusionsChanged = !sameList(nextExclusions, parsed.exclusions)
        const markerChanged = userHasMarker && parsed.patterns.some((p) => patternKey(p) === key && p !== pattern)
        if (nextTarget === parsed.target && !exclusionsChanged && !markerChanged) continue

        const allMatch = parsed.patterns.every((p) => patternKey(p) === key)
        if (allMatch && !exclusionsChanged && !markerChanged) {
            segments[s] = replaceTargetInPlace(line, nextTarget)
            continue
        }

        // Split the line into consecutive groups so other patterns on the same line
        // keep their target / exclusions and the original order is preserved.
        const groups: Array<{ match: boolean; patterns: string[] }> = []
        for (const p of parsed.patterns) {
            const match = patternKey(p) === key
            const last = groups[groups.length - 1]
            if (last && last.match === match) last.patterns.push(p)
            else groups.push({ match, patterns: [p] })
        }
        if (groups.some((g) => startsAsComment(g.match && userHasMarker ? pattern : g.patterns[0]))) throw new RuleLineSplitError()
        const lines = groups.map((g) => g.match
            ? formatLine(parsed.leading, g.patterns.map((p) => (userHasMarker ? pattern : p)), nextExclusions, nextTarget)
            : formatLine(parsed.leading, g.patterns, parsed.exclusions, parsed.target))
        const eol = segments[s + 1] !== undefined ? segments[s + 1] : (content.includes('\r\n') ? '\r\n' : '\n')
        segments[s] = lines.join(eol)
    }

    return { content: segments.join(''), found }
}

/**
 * Add a rule. An existing pattern is updated in place (its exclusions are kept
 * unless `exclusions` is given); otherwise a new line is appended at the end.
 */
export function addRouteRule(content: string, edit: RouteRuleEdit & { target: string }): { content: string; existed: boolean } {
    const updated = updateRouteRule(content, edit)
    if (updated.found) return { content: updated.content, existed: true }
    if (startsAsComment(edit.pattern)) throw new RuleNewRuleCommentError()

    const line = formatLine('', [edit.pattern], edit.exclusions || [], edit.target)
    if (content === '' || content === BOM) return { content: content + line, existed: false }
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    if (/\r?\n$/.test(content)) return { content: `${content}${line}${eol}`, existed: false }
    return { content: `${content}${eol}${line}`, existed: false }
}

/**
 * Remove every enabled occurrence of `pattern`. Other patterns on the same line
 * stay; a line left without patterns is removed with its line ending.
 */
export function deleteRouteRule(content: string, edit: { pattern: string }): { content: string; found: boolean } {
    return withBom(content, (text) => deleteLines(text, edit))
}

function deleteLines(content: string, edit: { pattern: string }): { content: string; found: boolean } {
    const key = patternKey(edit.pattern)
    const segments = splitLines(content)
    const out: string[] = []
    let found = false

    for (let s = 0; s < segments.length; s += 2) {
        const line = segments[s]
        const eol = segments[s + 1]
        const parsed = parseRuleLine(line)
        if (!parsed || !parsed.patterns.some((p) => patternKey(p) === key)) {
            out.push(line)
            if (eol !== undefined) out.push(eol)
            continue
        }
        found = true
        if (parsed.patterns.every((p) => patternKey(p) === key)) {
            // Drop the whole line. For a last line without a line ending, drop the
            // previous line's ending instead so no dangling empty line is left behind.
            if (eol === undefined && out.length > 0) out.pop()
            continue
        }
        if (startsAsComment(parsed.patterns.find((p) => patternKey(p) !== key) as string)) throw new RuleLineSplitError()
        out.push(removePatternTokens(line, new Set([key])))
        if (eol !== undefined) out.push(eol)
    }

    return { content: out.join(''), found }
}

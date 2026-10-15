import type { RuleItem } from '@/types'

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_PATTERN = /^(?:[0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}(?:%[\w.-]+)?$/
const HOSTS_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

function isHostsAddressToken(value: string): boolean {
  return IPV4_PATTERN.test(value) || IPV6_PATTERN.test(value)
}

function formatHostsTarget(address: string): string {
  return address.includes(':') && !address.startsWith('[') ? `[${address}]` : address
}

function stripHostsComment(line: string): string {
  const commentIndex = line.indexOf('#')
  return (commentIndex >= 0 ? line.slice(0, commentIndex) : line).trim()
}

function convertHostsLineToEprc(line: string): string | null {
  const stripped = stripHostsComment(line)
  if (!stripped) return null

  const [address, ...hosts] = stripped.split(/\s+/).filter(Boolean)
  if (!address || hosts.length === 0 || !isHostsAddressToken(address)) return null
  if (!hosts.every((host) => HOSTS_NAME_PATTERN.test(host))) return null

  return `${hosts.join(' ')} ${formatHostsTarget(address)}`
}

/**
 * Convert system hosts file text into EPRC text.
 * Hosts line format: `127.0.0.1 example.com api.example.com`
 * EPRC line format: `example.com api.example.com 127.0.0.1`
 */
export function hostsTextToEprc(text: string): string {
  return text
    .split(/\r?\n/)
    .flatMap((line) => convertHostsLineToEprc(line) ?? [])
    .join('\n')
}

export function normalizeImportedRuleText(text: string): string {
  let converted = false
  const normalized = text
    .split(/\r?\n/)
    .map((line) => {
      const hostsLine = convertHostsLineToEprc(line)
      if (!hostsLine) return line
      converted = true
      return hostsLine
    })
    .join('\n')

  return converted ? normalized : text
}

export interface EprcTextDiagnostic {
  line: number
  content: string
}

export function getEprcTextDiagnostics(text: string): EprcTextDiagnostic[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return []

      const ruleText = trimmed.startsWith('//') ? trimmed.slice(2).trim() : trimmed
      const regularParts = ruleText
        .split(/\s+/)
        .filter(Boolean)
        .filter((part) => !part.startsWith('!'))

      return regularParts.length >= 2
        ? []
        : [{ line: index + 1, content: line }]
    })
}

/**
 * Parse EPRC format text into RuleItem array
 * @param text - EPRC format text (one rule per line)
 * @returns Array of parsed rules
 */
export function parseEprcRules(text: string): RuleItem[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .flatMap((line) => {
      const trimmed = line.trim()

      // Skip comment lines (starting with #)
      if (trimmed.startsWith('#')) {
        return []
      }

      // Handle disabled rules (starting with //)
      let enabled = true
      if (trimmed.startsWith('//')) {
        enabled = false
        line = trimmed.slice(2).trim()
      } else {
        line = trimmed
      }

      const parts = line.split(/\s+/).filter(Boolean)
      if (parts.length < 2) return []

      // Separate exclusions (tokens starting with !) from regular parts
      const exclusions: string[] = []
      const regularParts = parts.filter(p => {
        if (p.startsWith('!')) {
          exclusions.push(p.slice(1)) // Remove ! prefix
          return false
        }
        return true
      })

      if (regularParts.length < 2) return [] // Need at least one rule and one target

      const target = regularParts[regularParts.length - 1]
      const targetRules = regularParts.slice(0, -1)
      return targetRules.map((rule) => ({ rule, target, enabled, exclusions: [...exclusions] }))
    })
}

/**
 * Convert RuleItem array back to EPRC format text
 * @param rules - Array of rules to convert
 * @returns EPRC format text
 */
export function rulesToEprc(rules: RuleItem[]): string {
  return rules
    .map((r) => {
      const prefix = r.enabled ? '' : '//'
      const exclusionStr = (r.exclusions || []).map(e => `!${e}`).join(' ')
      const parts = exclusionStr ? [r.rule, exclusionStr, r.target] : [r.rule, r.target]
      return `${prefix}${parts.join(' ')}`
    })
    .join('\n')
}

export const SPLIT_UNSAFE_MESSAGE = '该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改'

/**
 * Issue #145: a rule whose pattern starts with `//` or `#` cannot be written on
 * a line of its own (it would read back as a disabled rule or a comment). Thrown
 * by `rulesToEprcPreserving` instead of silently changing the rule; same message
 * as the CLI / MCP / Agent write paths.
 */
export class RuleLineSplitError extends Error {
  readonly code = 'RULE_LINE_SPLIT_UNSAFE'

  constructor() {
    super(SPLIT_UNSAFE_MESSAGE)
    this.name = 'RuleLineSplitError'
  }
}

function canonicalRuleLine(rule: RuleItem): string {
  if (rule.enabled && (rule.rule.startsWith('//') || rule.rule.startsWith('#'))) throw new RuleLineSplitError()
  return rulesToEprc([rule])
}

function sameRuleItem(a: RuleItem, b: RuleItem): boolean {
  const ae = a.exclusions || []
  const be = b.exclusions || []
  return a.enabled === b.enabled
    && a.rule === b.rule
    && a.target === b.target
    && ae.length === be.length
    && ae.every((e, i) => e === be[i])
}

/** Pairs equal items of `a` and `b` in order (longest common subsequence). */
function alignRuleItems(a: RuleItem[], b: RuleItem[]): { matchA: number[]; matchB: number[] } {
  const n = a.length
  const m = b.length
  const matchA = new Array<number>(n).fill(-1)
  const matchB = new Array<number>(m).fill(-1)
  if (n === 0 || m === 0) return { matchA, matchB }

  if ((n + 1) * (m + 1) > 4_000_000) {
    // Very large files: greedy in-order matching keeps memory bounded.
    let i = 0
    for (let j = 0; j < m && i < n; j++) {
      for (let x = i; x < n; x++) {
        if (sameRuleItem(a[x], b[j])) {
          matchA[x] = j
          matchB[j] = x
          i = x + 1
          break
        }
      }
    }
    return { matchA, matchB }
  }

  const width = m + 1
  const dp = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = sameRuleItem(a[i], b[j])
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (sameRuleItem(a[i], b[j])) {
      matchA[i] = j
      matchB[j] = i
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return { matchA, matchB }
}

/**
 * Issue #145: serialize the table view back to text without losing what the
 * table does not show. Comments, blank lines and unrecognised lines from
 * `originalText` stay where they were, and every rule line whose rules are
 * unchanged is written back byte for byte (multi-pattern lines stay one line).
 * Only added or edited rules are written in the canonical `rule !excl target`
 * form. Falls back to `rulesToEprc` when there is no original text.
 */
export function rulesToEprcPreserving(rules: RuleItem[], originalText: string): string {
  // A leading UTF-8 BOM belongs to the file, not to the first line.
  if (originalText.startsWith('\uFEFF')) return '\uFEFF' + rulesToEprcPreserving(rules, originalText.slice(1))
  if (!originalText) return rulesToEprc(rules)

  const eol = originalText.includes('\r\n') ? '\r\n' : '\n'
  const entries = originalText.split(/\r?\n/).map((raw) => {
    const items = parseEprcRules(raw)
    return { raw, items: items.length > 0 ? items : null }
  })

  const flat: Array<{ entry: number; k: number }> = []
  const flatItems: RuleItem[] = []
  entries.forEach((entry, index) => {
    entry.items?.forEach((item, k) => {
      flat.push({ entry: index, k })
      flatItems.push(item)
    })
  })

  const { matchA, matchB } = alignRuleItems(flatItems, rules)

  // A rule line is intact when all of its rules survive, unchanged and adjacent.
  const firstFlat = new Array<number>(entries.length).fill(-1)
  flat.forEach((f, idx) => { if (firstFlat[f.entry] < 0) firstFlat[f.entry] = idx })
  const intact = entries.map((entry, index) => {
    if (!entry.items) return false
    const start = firstFlat[index]
    const j0 = matchA[start]
    if (j0 < 0) return false
    return entry.items.every((_, k) => matchA[start + k] === j0 + k)
  })
  const unmatchedLeft = entries.map((entry, index) =>
    entry.items ? entry.items.filter((_, k) => matchA[firstFlat[index] + k] < 0).length : 0)

  // Entry of the next matched rule at or after each position of `rules`.
  const nextMatchedEntry = new Array<number>(rules.length + 1).fill(entries.length)
  for (let j = rules.length - 1; j >= 0; j--) {
    nextMatchedEntry[j] = matchB[j] >= 0 ? flat[matchB[j]].entry : nextMatchedEntry[j + 1]
  }

  let tailStart = entries.length
  while (tailStart > 0 && !entries[tailStart - 1].raw.trim()) tailStart--

  const out: string[] = []
  let ptr = 0
  const flushUntil = (index: number) => {
    for (; ptr < index; ptr++) {
      if (!entries[ptr].items) out.push(entries[ptr].raw)
    }
  }

  let j = 0
  while (j < rules.length) {
    const oi = matchB[j]
    if (oi >= 0) {
      const { entry, k } = flat[oi]
      flushUntil(entry)
      const items = entries[entry].items as RuleItem[]
      if (intact[entry] && k === 0) {
        out.push(entries[entry].raw)
        j += items.length
        ptr = entry + 1
        continue
      }
      out.push(canonicalRuleLine(rules[j]))
      j++
      continue
    }

    // An added or edited rule takes the place of the first changed original
    // rule line before the next unchanged one, so that line's comments stay above it.
    const limit = nextMatchedEntry[j + 1]
    let replaced = false
    for (let x = ptr; x < limit; x++) {
      if (entries[x].items && unmatchedLeft[x] > 0) {
        flushUntil(x)
        unmatchedLeft[x]--
        replaced = true
        break
      }
    }
    // A rule added after every existing rule goes to the end of the file
    // (before trailing blank lines), like the CLI / MCP add.
    if (!replaced && limit === entries.length) flushUntil(tailStart)
    out.push(canonicalRuleLine(rules[j]))
    j++
  }
  flushUntil(entries.length)
  return out.join(eol)
}

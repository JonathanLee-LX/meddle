/**
 * Line-preserving edits of route rule files (issue #145).
 *
 * The old write path parsed a rule file into a ruleMap and rebuilt the whole
 * text, which dropped comments, blank lines, disabled (`//`) rules and — in the
 * CLI — every other rule's exclusions (`!path`). These helpers edit only the
 * lines that hold the target pattern; every other line keeps its exact bytes
 * (including its line ending).
 *
 * Kept in sync with core/rule-file-edit.ts (same convention as
 * bin/lib/meddle-home.js ↔ core/meddle-home.ts).
 */

const MARKER = /\[([^\]]+)\]/

/** Internal key of a pattern token: `[marker]` brackets removed (same as the parser). */
function patternKey(token) {
  const bm = token.match(MARKER)
  return bm ? token.replace(bm[0], bm[1]) : token
}

/** Split into [line, eol, line, eol, ..., line]; the parser splits on /\r?\n/ too. */
function splitLines(content) {
  return content.split(/(\r?\n)/)
}

/**
 * Parse one line the way parseEprcWithExclusions does. Returns null for blank
 * lines, `#` comments, `//` disabled rules and lines that are not rules.
 */
function parseRuleLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const exclusionTokens = parts.filter((p) => p.startsWith('!'))
  const regular = parts.filter((p) => !p.startsWith('!'))
  if (regular.length < 2) return null
  return {
    leading: line.match(/^\s*/)[0],
    patterns: regular.slice(0, -1),
    target: regular[regular.length - 1],
    exclusions: exclusionTokens.map((t) => t.slice(1)),
  }
}

function formatLine(leading, patterns, exclusions, target) {
  const parts = patterns.slice()
  for (const e of exclusions) parts.push(`!${e}`)
  parts.push(target)
  return `${leading}${parts.join(' ')}`
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Replace the last regular (target) token in place, keeping all spacing. */
function replaceTargetInPlace(line, target) {
  const tokens = line.match(/\s+|\S+/g) || []
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/\S/.test(tokens[i]) && !tokens[i].startsWith('!')) {
      tokens[i] = target
      return tokens.join('')
    }
  }
  return line
}

/** Remove the given non-space token indexes (and one adjacent separator each). */
function removePatternTokens(line, keys) {
  const tokens = line.match(/\s+|\S+/g) || []
  const nonSpace = []
  tokens.forEach((t, i) => { if (/\S/.test(t)) nonSpace.push(i) })
  const regularIdx = nonSpace.filter((i) => !tokens[i].startsWith('!'))
  const patternIdx = regularIdx.slice(0, -1)
  const drop = new Set()
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
 * Normalise a user-supplied pattern argument. The CLI accepts exclusions inside
 * the pattern argument (`"app.example.com !/api"`), so split those out.
 */
function splitPatternArg(raw) {
  const parts = String(raw).trim().split(/\s+/).filter(Boolean)
  const patterns = parts.filter((p) => !p.startsWith('!'))
  const exclusions = parts.filter((p) => p.startsWith('!')).map((p) => p.slice(1)).filter(Boolean)
  return { patterns, exclusions }
}

/**
 * Point every enabled occurrence of `pattern` at `target` (if given) and/or set
 * its exclusions (if given; `undefined` keeps each line's own exclusions).
 * Lines that do not contain the pattern are left untouched.
 * @returns {{ content: string, found: boolean }}
 */
function updateRouteRule(content, { pattern, target, exclusions }) {
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
    const groups = []
    for (const p of parsed.patterns) {
      const match = patternKey(p) === key
      const last = groups[groups.length - 1]
      if (last && last.match === match) last.patterns.push(p)
      else groups.push({ match, patterns: [p] })
    }
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
 * @returns {{ content: string, existed: boolean }}
 */
function addRouteRule(content, { pattern, target, exclusions }) {
  const updated = updateRouteRule(content, { pattern, target, exclusions })
  if (updated.found) return { content: updated.content, existed: true }

  const line = formatLine('', [pattern], exclusions || [], target)
  if (content === '') return { content: line, existed: false }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  if (/\r?\n$/.test(content)) return { content: `${content}${line}${eol}`, existed: false }
  return { content: `${content}${eol}${line}`, existed: false }
}

/**
 * Remove every enabled occurrence of `pattern`. Other patterns on the same line
 * stay; a line left without patterns is removed with its line ending.
 * @returns {{ content: string, found: boolean }}
 */
function deleteRouteRule(content, { pattern }) {
  const key = patternKey(pattern)
  const segments = splitLines(content)
  const out = []
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
    out.push(removePatternTokens(line, new Set([key])))
    if (eol !== undefined) out.push(eol)
  }

  return { content: out.join(''), found }
}

module.exports = {
  patternKey,
  parseRuleLine,
  splitPatternArg,
  addRouteRule,
  updateRouteRule,
  deleteRouteRule,
}

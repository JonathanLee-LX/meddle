/**
 * Local route preview logic (for CLI when proxy is not running)
 * Ported from core/route-preview.ts
 */

const { parseEprcWithExclusions } = require('./parsers')

function getTargetKind(target) {
  const trimmed = target.trim()
  if (!trimmed) return 'empty'
  if (/^file:\/\//i.test(trimmed) || /^[A-Za-z]:\\|^\//.test(trimmed)) return 'file'
  if (/^(https?|wss?):\/\//i.test(trimmed)) return 'absolute-url'
  return 'host'
}

function buildNotes(kind, target, resolvedUrl, inputUrl) {
  const notes = []

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

function testRulePattern(pattern, input) {
  function looksLikeWildcardPattern(p) {
    if (!p.includes('*')) return false
    return !/[\\^$+?()[\]{}|]/.test(p)
  }

  function isSimplePattern(p) {
    return !/[\\^$+?()[\]{}|]/.test(p) && !p.includes('*')
  }

  function escapeRegexLiteral(value) {
    return value.replace(/[|\\{}()[\]^$+?.*]/g, '\\$&')
  }

  function wildcardPatternToRegex(p) {
    const escaped = escapeRegexLiteral(p)
    const withOptionalSubdomain = p.startsWith('*.')
      ? escaped.replace(/^\\\*\\\./, '(?:[^/:?#]+\\.)*')
      : escaped
    const regexSource = withOptionalSubdomain.replace(/\\\*/g, '.*')
    return new RegExp(regexSource)
  }

  if (looksLikeWildcardPattern(pattern)) {
    return wildcardPatternToRegex(pattern).test(input)
  }
  if (isSimplePattern(pattern)) {
    const escaped = escapeRegexLiteral(pattern)
    return new RegExp(escaped).test(input)
  }
  return new RegExp(pattern).test(input)
}

function applyRuleTarget(url, urlSegment) {
  const originUrlObj = new URL(url)

  const bracketMatch = urlSegment.match(/\[([^\]]+)\]/)
  if (bracketMatch) {
    const marker = bracketMatch[1]
    const markerIdx = url.indexOf(marker)
    const before = urlSegment.substring(0, bracketMatch.index)
    const after = urlSegment.substring(bracketMatch.index + bracketMatch[0].length)
    if (markerIdx !== -1) {
      const tail = url.substring(markerIdx + marker.length)
      urlSegment = (before + tail + after).replace(/([^:])\/\//g, '$1/')
    } else {
      urlSegment = before + after
    }
  }

  if (!urlSegment.startsWith('http') && !urlSegment.startsWith('ws') && !urlSegment.startsWith('file')) {
    urlSegment = originUrlObj.protocol + urlSegment
  }

  if (urlSegment.startsWith('file://')) {
    return urlSegment
  }

  const targetURLObj = new URL(urlSegment)

  if (!targetURLObj.port && originUrlObj.port) {
    targetURLObj.port = originUrlObj.port
  }

  if (targetURLObj.pathname === '/' && originUrlObj.pathname !== '/') {
    targetURLObj.pathname = originUrlObj.pathname
  }

  if (targetURLObj.search === '' && originUrlObj.search) {
    targetURLObj.search = originUrlObj.search
  }

  const originIsWs = /^wss?:\/\//.test(url)
  const targetIsHttp = /^https?:\/\//.test(targetURLObj.toString())
  if (originIsWs && targetIsHttp) {
    targetURLObj.protocol = originUrlObj.protocol
  }

  return targetURLObj.toString()
}

function findMatchedRouteRule(url, rules) {
  for (const entry of rules) {
    if (!testRulePattern(entry.pattern, url)) continue
    if (entry.exclusions.some((exc) => testRulePattern(exc, url))) continue
    const resolvedUrl = applyRuleTarget(url, entry.target)
    if (resolvedUrl) {
      return { entry, resolvedUrl }
    }
  }
  return null
}

function previewRouteTargetLocal(inputUrl, rulesText) {
  let parsedUrl
  try {
    parsedUrl = new URL(inputUrl)
  } catch {
    throw new Error('请输入合法的 URL')
  }

  const { rules } = parseEprcWithExclusions(rulesText)
  const matched = findMatchedRouteRule(parsedUrl.toString(), rules)

  if (!matched) {
    return {
      inputUrl: parsedUrl.toString(),
      matched: false,
      resolvedUrl: parsedUrl.toString(),
      notes: ['未命中规则，保持原 URL'],
    }
  }

  const { entry, resolvedUrl } = matched
  const kind = getTargetKind(entry.target)

  return {
    inputUrl: parsedUrl.toString(),
    matched: true,
    resolvedUrl,
    matchedRule: {
      pattern: entry.pattern,
      target: entry.target,
      kind,
    },
    notes: buildNotes(kind, entry.target, resolvedUrl, parsedUrl.toString()),
  }
}

module.exports = {
  previewRouteTargetLocal,
  testRulePattern,
  findMatchedRouteRule,
  getTargetKind,
}

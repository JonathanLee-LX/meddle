/**
 * EPRC file parsers
 * Ported from helpers.ts
 */

const path = require('path')

const FILE_PATTERN = /^file:\/\//
const LOCAL_FILE_PATTERN = /^[A-Za-z]:\\|^\/|^\\/

function routeRulesToLegacyMaps(rules) {
  const ruleMap = Object.create(null)
  const excludeMap = Object.create(null)
  for (const entry of rules) {
    ruleMap[entry.pattern] = entry.target
    excludeMap[entry.pattern] = entry.exclusions.slice()
  }
  return { ruleMap, excludeMap }
}

/**
 * Parse EPRC content into ordered rules + legacy ruleMap/excludeMap
 */
function parseEprcWithExclusions(content) {
  const rules = []

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return

    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return

    const exclusions = []
    const regularParts = parts.filter(p => {
      if (p.startsWith('!')) {
        exclusions.push(p.slice(1))
        return false
      }
      return true
    })

    if (regularParts.length < 2) return

    let target = regularParts[regularParts.length - 1]
    const patterns = regularParts.slice(0, -1)

    if (LOCAL_FILE_PATTERN.test(target) && !FILE_PATTERN.test(target)) {
      target = 'file://' + target.replace(/\\/g, '/')
    }

    const lineExclusions = exclusions.slice()

    patterns.forEach(rule => {
      const bm = rule.match(/\[([^\]]+)\]/)
      let patternKey
      let storedTarget = target
      if (bm) {
        patternKey = rule.replace(bm[0], bm[1])
        storedTarget = target + bm[0]
      } else {
        patternKey = rule
      }

      rules.push({
        pattern: patternKey,
        target: storedTarget,
        exclusions: lineExclusions,
      })
    })
  })

  const { ruleMap, excludeMap } = routeRulesToLegacyMaps(rules)
  return { rules, ruleMap, excludeMap }
}

/**
 * Parse EPRC content into ruleMap (without exclusions)
 */
function parseEprc(content) {
  return parseEprcWithExclusions(content).ruleMap
}

/**
 * Convert ruleMap back to EPRC text format
 */
function ruleMapToEprcText(ruleMap, excludeMap) {
  const entries = Object.entries(ruleMap)
  if (entries.length === 0) return ''

  const byTargetAndExclusions = {}

  entries.forEach(([rule, target]) => {
    const bm = target.match(/\[([^\]]+)\]/)
    const groupKey = bm ? target.replace(bm[0], '') : target
    const displayRule = bm ? rule.replace(bm[1], bm[0]) : rule
    const exclusions = excludeMap?.[rule] || []
    const exclusionsKey = exclusions.join(',')

    const compoundKey = `${groupKey}|||${exclusionsKey}`

    if (!byTargetAndExclusions[compoundKey]) {
      byTargetAndExclusions[compoundKey] = { target: groupKey, rules: [], exclusions }
    }
    byTargetAndExclusions[compoundKey].rules.push(displayRule)
  })

  return Object.values(byTargetAndExclusions)
    .map(({ target, rules, exclusions }) => {
      let displayTarget = target
      if (FILE_PATTERN.test(target)) {
        displayTarget = target.replace(/^file:\/\//, '').replace(/\//g, path.sep)
      }

      const exclusionStr = exclusions.map(e => `!${e}`).join(' ')
      const rulesStr = rules.join(' ')
      return exclusionStr ? `${rulesStr} ${exclusionStr} ${displayTarget}` : `${rulesStr} ${displayTarget}`
    })
    .join('\n')
}

module.exports = {
  parseEprcWithExclusions,
  parseEprc,
  ruleMapToEprcText,
  routeRulesToLegacyMaps,
}

/**
 * EPRC file parsers
 * Ported from helpers.ts
 */

const path = require('path')

const IP_PATTERN = /^\d+\.\d+\.\d+\.\d+(:\d+)?$/
const URL_PATTERN = /^https?:\/\//
const FILE_PATTERN = /^file:\/\//
const LOCAL_FILE_PATTERN = /^[A-Za-z]:\\|^\/|^\\/

/**
 * Parse EPRC content into ruleMap and excludeMap
 */
function parseEprcWithExclusions(content) {
  const ruleMap = Object.create(null)
  const excludeMap = Object.create(null)

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return

    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return

    // Separate exclusions (tokens starting with !) from regular parts
    const exclusions = []
    const regularParts = parts.filter(p => {
      if (p.startsWith('!')) {
        exclusions.push(p.slice(1)) // Remove ! prefix
        return false
      }
      return true
    })

    if (regularParts.length < 2) return // Need at least one rule and one target

    let target
    let rules

    if (FILE_PATTERN.test(regularParts[0]) || LOCAL_FILE_PATTERN.test(regularParts[0])) {
      target = regularParts[0]
      rules = regularParts.slice(1)
      if (!FILE_PATTERN.test(target) && LOCAL_FILE_PATTERN.test(target)) {
        target = 'file://' + target.replace(/\\/g, '/')
      }
    } else if (IP_PATTERN.test(regularParts[0]) || URL_PATTERN.test(regularParts[0])) {
      target = regularParts[0]
      rules = regularParts.slice(1)
    } else {
      const reversed = [...regularParts].reverse()
      target = reversed[0]
      rules = reversed.slice(1)
      if (LOCAL_FILE_PATTERN.test(target)) {
        target = 'file://' + target.replace(/\\/g, '/')
      }
    }

    rules.forEach(rule => {
      const bm = rule.match(/\[([^\]]+)\]/)
      let patternKey
      if (bm) {
        patternKey = rule.replace(bm[0], bm[1])
        ruleMap[patternKey] = target + bm[0]
      } else {
        patternKey = rule
        ruleMap[patternKey] = target
      }

      // Always set exclusions (even empty array) to override any previous rule
      excludeMap[patternKey] = exclusions.slice() // Copy the array
    })
  })

  return { ruleMap, excludeMap }
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

  // Group by (target, exclusionsKey) to handle rules with different exclusions
  const byTargetAndExclusions = {}

  entries.forEach(([rule, target]) => {
    const bm = target.match(/\[([^\]]+)\]/)
    const groupKey = bm ? target.replace(bm[0], '') : target
    const displayRule = bm ? rule.replace(bm[1], bm[0]) : rule
    const exclusions = excludeMap?.[rule] || []
    const exclusionsKey = exclusions.join(',')

    // Create a compound key that includes both target and exclusions
    const compoundKey = `${groupKey}|||${exclusionsKey}`

    if (!byTargetAndExclusions[compoundKey]) {
      byTargetAndExclusions[compoundKey] = { target: groupKey, rules: [], exclusions }
    }
    byTargetAndExclusions[compoundKey].rules.push(displayRule)
  })

  return Object.values(byTargetAndExclusions)
    .map(({ target, rules, exclusions }) => {
      const targetFirst = IP_PATTERN.test(target) || URL_PATTERN.test(target) || FILE_PATTERN.test(target)
      let displayTarget = target
      if (FILE_PATTERN.test(target)) {
        displayTarget = target.replace(/^file:\/\//, '').replace(/\//g, path.sep)
      }

      const exclusionStr = exclusions.map(e => `!${e}`).join(' ')
      const rulesStr = rules.join(' ')

      if (targetFirst) {
        return exclusionStr ? `${displayTarget} ${rulesStr} ${exclusionStr}` : `${displayTarget} ${rulesStr}`
      } else {
        return exclusionStr ? `${rulesStr} ${exclusionStr} ${displayTarget}` : `${rulesStr} ${displayTarget}`
      }
    })
    .join('\n')
}

module.exports = {
  parseEprcWithExclusions,
  parseEprc,
  ruleMapToEprcText
}
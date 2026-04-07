import type { RuleItem } from '@/types'

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

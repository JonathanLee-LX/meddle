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

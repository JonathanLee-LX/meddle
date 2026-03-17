import { useMemo, useState } from 'react'
import type { ProxyRecord, ResourceType } from '@/types'
import { getResourceType } from '@/utils/resource-type'

/**
 * Chrome DevTools style fuzzy filter for proxy records.
 * Supports:
 * - Plain text: fuzzy match against source URL
 * - method:GET / method:POST: filter by HTTP method
 * - status:2xx / status:404: filter by status code pattern
 * - domain:example.com: filter by domain
 * - -keyword: negative filter (exclude)
 * - Multiple terms separated by space (AND logic)
 * - Resource type filter: 'all', 'fetch', 'doc', 'css', 'js', 'font', 'img', 'media', 'manifest', 'websocket', 'wasm', 'other'
 */
export function useFuzzyFilter(records: ProxyRecord[]) {
  const [filterText, setFilterText] = useState('')
  const [resourceTypeFilter, setResourceTypeFilter] = useState<ResourceType>('all')

  const filteredRecords = useMemo(() => {
    // First filter by resource type
    let result = records
    if (resourceTypeFilter !== 'all') {
      result = result.filter((record) => getResourceType(record) === resourceTypeFilter)
    }
    
    // Then filter by text
    const raw = filterText.trim()
    if (!raw) return result

    const terms = raw.split(/\s+/).filter(Boolean)

    return result.filter((record) => {
      const method = typeof record.method === 'string' ? record.method : ''
      const source = typeof record.source === 'string' ? record.source : ''
      const target = typeof record.target === 'string' ? record.target : ''
      const time = typeof record.time === 'string' ? record.time : ''

      return terms.every((term) => {
        const isNegative = term.startsWith('-') && term.length > 1
        const cleanTerm = isNegative ? term.slice(1) : term

        let matches = false

        // method: filter
        if (cleanTerm.startsWith('method:')) {
          const expectedMethod = cleanTerm.slice(7).toUpperCase()
          matches = method.toUpperCase() === expectedMethod
        }
        // status: filter (e.g., status:200, status:4xx, status:5xx)
        else if (cleanTerm.startsWith('status:')) {
          const pattern = cleanTerm.slice(7).toLowerCase()
          if (!record.statusCode) {
            matches = false
          } else if (pattern.includes('x')) {
            const prefix = pattern.replace(/x/gi, '')
            matches = record.statusCode.toString().startsWith(prefix)
          } else {
            matches = record.statusCode.toString() === pattern
          }
        }
        // domain: filter
        else if (cleanTerm.startsWith('domain:')) {
          const domain = cleanTerm.slice(7).toLowerCase()
          try {
            const url = new URL(source)
            matches = url.hostname.toLowerCase().includes(domain)
          } catch {
            matches = source.toLowerCase().includes(domain)
          }
        }
        // Plain text fuzzy match against source, target, method
        else {
          const lower = cleanTerm.toLowerCase()
          const haystack = `${method} ${source} ${target} ${time}`.toLowerCase()
          // Fuzzy: check if all characters appear in order
          matches = fuzzyMatch(lower, haystack)
        }

        return isNegative ? !matches : matches
      })
    })
  }, [records, filterText, resourceTypeFilter])

  return { filterText, setFilterText, resourceTypeFilter, setResourceTypeFilter, filteredRecords }
}

function fuzzyMatch(needle: string, haystack: string): boolean {
  // First try simple includes
  if (haystack.includes(needle)) return true

  // Then try character-by-character fuzzy matching
  let ni = 0
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (needle[ni] === haystack[hi]) {
      ni++
    }
  }
  return ni === needle.length
}

import { useDeferredValue, useMemo, useState } from 'react'
import type { ClientSourceFilter, ProxyRecord, ResourceType } from '@/types'
import { getResourceType } from '@/utils/resource-type'

interface ProxyRecordSearchIndex {
  methodUpper: string
  statusCode: number | undefined
  statusText: string
  sourceLower: string
  domainLower: string
  clientLower: string
  clientIpLower: string
  applicationLower: string
  haystack: string
  resourceType: ResourceType
}

const searchIndexCache = new WeakMap<ProxyRecord, ProxyRecordSearchIndex>()

function getSearchIndex(record: ProxyRecord): ProxyRecordSearchIndex {
  const cached = searchIndexCache.get(record)
  if (cached) return cached

  const method = typeof record.method === 'string' ? record.method : ''
  const source = typeof record.source === 'string' ? record.source : ''
  const target = typeof record.target === 'string' ? record.target : ''
  const time = typeof record.time === 'string' ? record.time : ''
  const clientType = record.clientType || ''
  const clientIp = record.clientIp || ''
  const clientName = record.clientName || ''
  const applicationName = record.applicationName || ''
  const applicationProcess = record.applicationProcess || ''
  const applicationBundleId = record.applicationBundleId || ''
  const applicationPid = record.applicationPid?.toString() || ''
  const applicationIdentitySource = record.applicationIdentitySource || ''
  const applicationIdentityConfidence = record.applicationIdentityConfidence || ''
  let domain = source

  try {
    domain = new URL(source).hostname
  } catch {
    // Invalid or relative URLs fall back to matching the complete source.
  }

  const index: ProxyRecordSearchIndex = {
    methodUpper: method.toUpperCase(),
    statusCode: record.statusCode,
    statusText: record.statusCode?.toString() || '',
    sourceLower: source.toLowerCase(),
    domainLower: domain.toLowerCase(),
    clientLower: `${clientType} ${clientName} ${clientIp}`.toLowerCase(),
    clientIpLower: clientIp.toLowerCase(),
    applicationLower: `${applicationName} ${applicationProcess} ${applicationBundleId} ${applicationPid} ${applicationIdentitySource} ${applicationIdentityConfidence}`.toLowerCase(),
    haystack: `${method} ${source} ${target} ${time} ${clientType} ${clientIp} ${clientName} ${applicationName} ${applicationProcess} ${applicationBundleId} ${applicationPid} ${applicationIdentitySource} ${applicationIdentityConfidence}`.toLowerCase(),
    resourceType: getResourceType(record),
  }
  searchIndexCache.set(record, index)
  return index
}

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
  const [clientSourceFilter, setClientSourceFilter] = useState<ClientSourceFilter>('all')
  const deferredFilterText = useDeferredValue(filterText)

  const filteredRecords = useMemo(() => {
    const raw = deferredFilterText.trim()
    if (!raw && resourceTypeFilter === 'all' && clientSourceFilter === 'all') {
      return records
    }

    const terms = raw.split(/\s+/).filter(Boolean)
    const result: ProxyRecord[] = []

    for (const record of records) {
      if (clientSourceFilter !== 'all' && record.clientType !== clientSourceFilter) continue
      const index = getSearchIndex(record)
      if (resourceTypeFilter !== 'all' && index.resourceType !== resourceTypeFilter) continue

      const matchesAllTerms = terms.every((term) => {
        const isNegative = term.startsWith('-') && term.length > 1
        const cleanTerm = isNegative ? term.slice(1) : term
        const lowerTerm = cleanTerm.toLowerCase()

        let matches = false

        // method: filter
        if (lowerTerm.startsWith('method:')) {
          matches = index.methodUpper === cleanTerm.slice(7).toUpperCase()
        }
        // status: filter (e.g., status:200, status:4xx, status:5xx)
        else if (lowerTerm.startsWith('status:')) {
          const pattern = lowerTerm.slice(7)
          if (!index.statusCode) {
            matches = false
          } else if (pattern.includes('x')) {
            const prefix = pattern.replace(/x/gi, '')
            matches = index.statusText.startsWith(prefix)
          } else {
            matches = index.statusText === pattern
          }
        }
        // domain: filter
        else if (lowerTerm.startsWith('domain:')) {
          matches = index.domainLower.includes(lowerTerm.slice(7)) ||
            index.sourceLower.includes(lowerTerm.slice(7))
        }
        // client: filter (type, alias, or IP)
        else if (lowerTerm.startsWith('client:')) {
          matches = index.clientLower.includes(lowerTerm.slice(7))
        }
        // ip: filter
        else if (lowerTerm.startsWith('ip:')) {
          matches = index.clientIpLower.includes(lowerTerm.slice(3))
        }
        // app: filter (application name, process, bundle ID, or PID)
        else if (lowerTerm.startsWith('app:')) {
          matches = index.applicationLower.includes(lowerTerm.slice(4))
        }
        // Plain text fuzzy match against source, target, method
        else {
          matches = fuzzyMatch(lowerTerm, index.haystack)
        }

        return isNegative ? !matches : matches
      })

      if (matchesAllTerms) result.push(record)
    }
    return result
  }, [records, deferredFilterText, resourceTypeFilter, clientSourceFilter])

  return {
    filterText,
    setFilterText,
    resourceTypeFilter,
    setResourceTypeFilter,
    clientSourceFilter,
    setClientSourceFilter,
    filteredRecords,
  }
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

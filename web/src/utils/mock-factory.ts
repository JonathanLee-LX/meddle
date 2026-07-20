import type { MockRule } from '@/types'

/**
 * Default headers that should be filtered out when creating mocks
 * These are typically set by the server and not needed in mock responses
 */
const DEFAULT_HEADERS = [
  'content-length',
  'content-encoding',
  'connection',
  'date',
  'etag',
  'last-modified',
  'server',
]

/**
 * Filter response headers to only include custom headers
 * Removes common default headers that are automatically set by servers
 */
function filterCustomHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {}
  
  const customHeaders: Record<string, string> = {}
  Object.entries(headers).forEach(([key, value]) => {
    if (!DEFAULT_HEADERS.includes(key.toLowerCase())) {
      customHeaders[key] = value
    }
  })
  return customHeaders
}

/**
 * Remove truncation prefix from response body if present
 * Format: "(truncated, N bytes)\n" at the start of the body
 */
function cleanTruncatedBody(body: string): string {
  const truncatedMatch = body.match(/^\(truncated, \d+ bytes\)\n/)
  if (truncatedMatch) {
    return body.substring(truncatedMatch[0].length)
  }
  return body
}

/**
 * Escape special regex characters in a string
 * Useful for converting URLs to regex patterns
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CreateMockFromLogData {
  source: string
  responseBody: string
  statusCode: number
  responseHeaders?: Record<string, string>
}

/**
 * Create a mock rule from log data
 * Used when creating mocks from the detail panel
 */
export function createMockFromLog(data: CreateMockFromLogData): Partial<MockRule> {
  const customHeaders = filterCustomHeaders(data.responseHeaders)
  const cleanBody = cleanTruncatedBody(data.responseBody)
  
  return {
    urlPattern: escapeRegex(data.source),
    body: cleanBody,
    statusCode: data.statusCode,
    headers: customHeaders,
    name: '从日志创建',
    method: '*',
    enabled: true,
  }
}

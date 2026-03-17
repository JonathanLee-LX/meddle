import type { ProxyRecord, ResourceType } from '@/types'

/**
 * Determine resource type based on URL and method
 */
export function getResourceType(record: ProxyRecord): ResourceType {
  const source = typeof record.source === 'string' ? record.source : ''
  const methodValue = typeof record.method === 'string' ? record.method : ''
  const url = source.toLowerCase()
  const method = methodValue.toUpperCase()

  if (!url) {
    return 'other'
  }
  
  // WebSocket
  if (url.startsWith('ws://') || url.startsWith('wss://')) {
    return 'websocket'
  }
  
  // XHR/Fetch - typically JSON/API calls or non-GET methods
  if (method !== 'GET' || url.includes('/api/') || url.includes('.json')) {
    return 'fetch'
  }
  
  // Get file extension
  const urlWithoutQuery = url.split('?')[0].split('#')[0]
  const parts = urlWithoutQuery.split('/')
  const lastPart = parts[parts.length - 1] || ''
  const extension = lastPart.includes('.') ? lastPart.split('.').pop() || '' : ''
  
  // Document
  if (['html', 'htm', 'php', 'asp', 'aspx', 'jsp'].includes(extension)) {
    return 'doc'
  }
  
  // URLs without extension (like /page or /) should be doc
  if (!extension && method === 'GET') {
    return 'doc'
  }
  
  // CSS
  if (extension === 'css') {
    return 'css'
  }
  
  // JavaScript
  if (['js', 'mjs', 'jsx', 'ts', 'tsx'].includes(extension)) {
    return 'js'
  }
  
  // Font
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension)) {
    return 'font'
  }
  
  // Image
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(extension)) {
    return 'img'
  }
  
  // Media
  if (['mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'm4a'].includes(extension)) {
    return 'media'
  }
  
  // Manifest
  if (['manifest', 'webmanifest'].includes(extension)) {
    return 'manifest'
  }
  
  // WASM
  if (extension === 'wasm') {
    return 'wasm'
  }
  
  return 'other'
}

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ProxyRecord, RecordDetail } from '@/types'
import {
  DEFAULT_MAX_LOG_RECORDS,
  LOG_BATCH_INTERVAL_MS,
  mergeLogHistory,
  prependLogBatch,
} from '@/lib/log-records'

function isProxyRecordMessage(data: unknown): data is ProxyRecord {
  if (!data || typeof data !== 'object') return false
  const value = data as Record<string, unknown>
  return typeof value.id === 'number' &&
    typeof value.method === 'string' &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.time === 'string'
}

/**
 * Hook for managing proxy logs and details
 * Handles WebSocket connection, log records, and detail fetching
 */
export function useLogs(maxRecords: number = DEFAULT_MAX_LOG_RECORDS) {
  const [records, setRecords] = useState<ProxyRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const maxRecordsRef = useRef(maxRecords)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingRecordsRef = useRef<ProxyRecord[]>([])

  useEffect(() => {
    maxRecordsRef.current = maxRecords
  }, [maxRecords])

  // Load initial logs
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/logs', { signal: controller.signal })
      .then((res) => res.json())
      .then((json: ProxyRecord[]) => {
        setRecords((current) => mergeLogHistory(current, json, maxRecordsRef.current))
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(error)
        }
      })

    return () => controller.abort()
  }, [])

  // WebSocket for real-time updates with reconnection
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let flushTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    const MAX_RECONNECT_ATTEMPTS = 10
    const BASE_RECONNECT_DELAY = 1000

    const flushPendingRecords = () => {
      flushTimeout = null
      const pending = pendingRecordsRef.current
      if (pending.length === 0) return
      pendingRecordsRef.current = []
      setRecords((current) => prependLogBatch(current, pending, maxRecordsRef.current))
    }

    const schedulePendingFlush = () => {
      if (flushTimeout) return
      flushTimeout = setTimeout(flushPendingRecords, LOG_BATCH_INTERVAL_MS)
    }

    const connectWebSocket = () => {
      const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://'
      const ws = new WebSocket(protocol + location.host + '/ws')

      ws.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(ev.data) as { type?: string; rules?: unknown[] } & ProxyRecord
          if (data && data.type === 'mocksUpdated') {
            window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: data.rules ?? [] }))
            return
          }
          if (!isProxyRecordMessage(data)) return
          pendingRecordsRef.current.push(data)
          schedulePendingFlush()
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      })

      ws.addEventListener('error', (ev) => {
        console.error('WebSocket error:', ev)
      })

      ws.addEventListener('close', () => {
        console.log('WebSocket closed')
        wsRef.current = null

        // Exponential backoff reconnection
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 30000)
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`)
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++
            connectWebSocket()
          }, delay)
        } else {
          console.error('Max reconnection attempts reached')
        }
      })

      ws.addEventListener('open', () => {
        console.log('WebSocket connected')
        reconnectAttempts = 0 // Reset on successful connection
      })

      wsRef.current = ws
    }

    connectWebSocket()

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      pendingRecordsRef.current = []
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Fetch detail
  const fetchDetail = useCallback(async (id: number) => {
    setSelectedRecordId(id)
    setDetailLoading(true)
    setRecordDetail(null)
    setDetailError(null)
    try {
      const res = await fetch(`/api/logs/${id}`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || `加载详情失败 (${res.status})`)
      }
      setRecordDetail(data)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '加载详情失败')
      console.error('Failed to fetch detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedRecordId(null)
    setRecordDetail(null)
  }, [])

  const clearRecords = useCallback(() => {
    pendingRecordsRef.current = []
    setRecords([])
  }, [])

  // Replay request
  const replayRequest = useCallback(async (id: number) => {
    const res = await fetch(`/api/replay/${id}`, { method: 'POST' })
    const data = await res.json()
    if (data.status === 'success') {
      return data as { status: string; recordId: number; logData: ProxyRecord }
    }
    throw new Error(data.error || '重放请求失败')
  }, [])

  return {
    records,
    selectedRecordId,
    recordDetail,
    detailLoading,
    detailError,
    fetchDetail,
    closeDetail,
    clearRecords,
    replayRequest,
  }
}

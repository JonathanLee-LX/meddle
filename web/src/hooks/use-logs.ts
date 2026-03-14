import { useState, useEffect, useCallback, useRef } from 'react'
import type { ProxyRecord, RecordDetail } from '@/types'

/**
 * Hook for managing proxy logs and details
 * Handles WebSocket connection, log records, and detail fetching
 */
export function useLogs(maxRecords: number = 1000) {
  const [records, setRecords] = useState<ProxyRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const maxRecordsRef = useRef(maxRecords)
  maxRecordsRef.current = maxRecords
  const wsRef = useRef<WebSocket | null>(null)

  // Load initial logs
  useEffect(() => {
    fetch('/api/logs')
      .then((res) => res.json())
      .then((json: ProxyRecord[]) => setRecords(json))
      .catch(console.error)
  }, [])

  // WebSocket for real-time updates with reconnection
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    const MAX_RECONNECT_ATTEMPTS = 10
    const BASE_RECONNECT_DELAY = 1000

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
          setRecords((prev) => {
            const newRecords = [data as ProxyRecord, ...prev]
            return newRecords.slice(0, maxRecordsRef.current)
          })
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
    try {
      const res = await fetch(`/api/logs/${id}`)
      const data = await res.json()
      if (!data.error) {
        setRecordDetail(data)
      }
    } catch (err) {
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
    fetchDetail,
    closeDetail,
    clearRecords,
    replayRequest,
  }
}

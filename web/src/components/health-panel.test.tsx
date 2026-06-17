import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HealthPanel } from './health-panel'

const now = Date.UTC(2026, 5, 17, 10, 30, 0)

function createHealthResponse() {
  return {
    generatedAt: now,
    status: 'degraded',
    pid: 12345,
    uptimeSec: 3661,
    platform: 'darwin',
    memory: {
      rss: 120 * 1024 * 1024,
      heapTotal: 64 * 1024 * 1024,
      heapUsed: 32 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    },
    cpu: {
      percent: 87.4,
      cores: 8,
      loadAverage: [1.2, 0.8, 0.7],
    },
    eventLoop: {
      meanMs: 2.5,
      maxMs: 51.2,
    },
    process: {
      fdCount: 42,
      activeHandles: 14,
      activeRequests: 2,
    },
    connections: {
      proxySockets: 2,
      mitmTlsSockets: 3,
      webSockets: 1,
      total: 6,
    },
    mitmServers: {
      count: 1,
      activeSockets: 3,
      items: [{
        host: 'example.com',
        port: 443,
        activeSockets: 3,
        webSockets: 1,
        lastUsedAt: now,
        idleForMs: 1200,
      }],
    },
    logs: {
      windowMs: 60000,
      maxPerWindow: 20,
      suppressedTotal: 4,
      keys: [{
        key: 'watchdog:runtime-health',
        level: 'warn',
        windowStartedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        emitted: 20,
        suppressed: 4,
      }],
    },
    watchdog: {
      config: {
        enabled: true,
        action: 'exit',
        intervalMs: 30000,
        minUptimeMs: 30000,
        failureThreshold: 3,
        cpuPercent: 95,
        rssBytes: 1536 * 1024 * 1024,
        connectionCount: 1000,
        mitmServerCount: 100,
        fdCount: 2048,
        eventLoopDelayMs: 1000,
      },
      consecutiveFailures: 1,
      lastReason: 'cpu=96% limit=95%',
    },
    checks: [
      { name: 'cpu', status: 'degraded', value: 87.4, limit: 95, unit: '%' },
      { name: 'rss', status: 'ok', value: 120 * 1024 * 1024, limit: 1536 * 1024 * 1024, unit: 'bytes' },
      { name: 'connections', status: 'ok', value: 6, limit: 1000, unit: 'count' },
      { name: 'mitmServers', status: 'ok', value: 1, limit: 100, unit: 'count' },
      { name: 'eventLoopDelay', status: 'ok', value: 51.2, limit: 1000, unit: 'ms' },
      { name: 'fds', status: 'ok', value: 42, limit: 2048, unit: 'count' },
    ],
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('HealthPanel', () => {
  it('renders runtime health information from the health API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(createHealthResponse()), {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<HealthPanel />)

    expect(await screen.findByText('运行健康')).toBeInTheDocument()
    expect(screen.getAllByText('降级')[0]).toBeInTheDocument()
    expect(screen.getAllByText('87.4%')[0]).toBeInTheDocument()
    expect(screen.getAllByText('120 MB')[0]).toBeInTheDocument()
    expect(screen.getByText('PID 12345')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('watchdog:runtime-health')).toBeInTheDocument()
    expect(screen.getByText('退出重启')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '自动刷新健康信息' })).toBeChecked()
  })

  it('shows a recoverable error when the health API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service Unavailable', {
      status: 503,
    })))

    render(<HealthPanel />)

    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.getByText('健康接口返回 503')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检测' })).toBeInTheDocument()
  })
})

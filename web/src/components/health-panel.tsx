import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  ListChecks,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type HealthStatus = 'ok' | 'degraded' | 'critical'

interface HealthCheck {
  name: string
  status: HealthStatus
  value: number
  limit: number
  unit: string
}

interface MitmServerInfo {
  host: string
  port: number | null
  activeSockets: number
  webSockets: number
  lastUsedAt: number | null
  idleForMs: number | null
}

interface LogRateLimitEvent {
  key: string
  level: 'error' | 'warn' | 'info' | 'log'
  windowStartedAt: number
  firstSeenAt: number
  lastSeenAt: number
  emitted: number
  suppressed: number
}

interface LogRateLimitStats {
  windowMs: number
  maxPerWindow: number
  keys: LogRateLimitEvent[]
  suppressedTotal: number
}

interface WatchdogConfig {
  enabled: boolean
  action: 'exit' | 'warn'
  intervalMs: number
  minUptimeMs: number
  failureThreshold: number
  cpuPercent: number
  rssBytes: number
  connectionCount: number
  mitmServerCount: number
  fdCount: number
  eventLoopDelayMs: number
}

interface RuntimeHealth {
  generatedAt: number
  status: HealthStatus
  pid: number
  uptimeSec: number
  platform: string
  memory: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
  }
  cpu: {
    percent: number
    cores: number
    loadAverage: number[]
  }
  eventLoop: {
    meanMs: number
    maxMs: number
  }
  process: {
    fdCount: number | null
    activeHandles: number | null
    activeRequests: number | null
  }
  connections: {
    proxySockets: number
    mitmTlsSockets: number
    webSockets: number
    total: number
  }
  mitmServers: {
    count: number
    activeSockets: number
    items: MitmServerInfo[]
  }
  logs: unknown
  watchdog: {
    config: WatchdogConfig
    consecutiveFailures: number
    lastReason: string | null
  }
  checks: HealthCheck[]
}

const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: '正常',
  degraded: '降级',
  critical: '严重',
}

const CHECK_LABEL: Record<string, string> = {
  cpu: 'CPU',
  rss: 'RSS 内存',
  connections: '连接数',
  mitmServers: 'MITM 服务',
  eventLoopDelay: '事件循环延迟',
  fds: '文件描述符',
}

function isRuntimeHealth(value: unknown): value is RuntimeHealth {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeHealth>
  return typeof candidate.generatedAt === 'number'
    && typeof candidate.status === 'string'
    && typeof candidate.pid === 'number'
    && typeof candidate.uptimeSec === 'number'
    && Boolean(candidate.memory)
    && Boolean(candidate.cpu)
    && Boolean(candidate.connections)
    && Boolean(candidate.mitmServers)
    && Array.isArray(candidate.checks)
}

async function fetchRuntimeHealth(): Promise<RuntimeHealth> {
  const response = await fetch('/api/health', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`健康接口返回 ${response.status}`)
  }

  const data = await response.json()
  if (!isRuntimeHealth(data)) {
    throw new Error('健康接口返回格式不正确')
  }
  return data
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let current = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && current >= 1024; index += 1) {
    current /= 1024
    unit = units[index]
  }
  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${unit}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  if (minutes > 0) return `${minutes}分钟 ${secs}秒`
  return `${secs}秒`
}

function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatCheckValue(value: number, unit: string): string {
  if (unit === 'bytes') return formatBytes(value)
  if (unit === '%') return `${value.toFixed(1)}%`
  if (unit === 'ms') return `${value.toFixed(1)} ms`
  return String(value)
}

function formatLimit(value: number, unit: string): string {
  if (unit === 'bytes') return formatBytes(value)
  if (unit === '%') return `${value}%`
  if (unit === 'ms') return `${value} ms`
  return String(value)
}

function normalizeLogStats(value: unknown): LogRateLimitStats | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LogRateLimitStats>
  if (!Array.isArray(candidate.keys)) return null
  return {
    windowMs: Number(candidate.windowMs) || 0,
    maxPerWindow: Number(candidate.maxPerWindow) || 0,
    keys: candidate.keys,
    suppressedTotal: Number(candidate.suppressedTotal) || 0,
  }
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const icon = status === 'ok' ? <CheckCircle2 /> : status === 'degraded' ? <AlertTriangle /> : <XCircle />
  return (
    <Badge variant={status === 'critical' ? 'destructive' : status === 'degraded' ? 'secondary' : 'default'}>
      {icon}
      {STATUS_LABEL[status]}
    </Badge>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="min-h-4 truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </div>
      </CardContent>
    </Card>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium" title={value}>
        {value}
      </span>
    </div>
  )
}

function LoadingHealthPanel() {
  return (
    <div className="app-workspace-content" aria-label="正在读取健康状态">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}

export function HealthPanel() {
  const [health, setHealth] = useState<RuntimeHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadHealth = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')

    try {
      setHealth(await fetchRuntimeHealth())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取健康状态')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      void loadHealth(true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadHealth])

  const logStats = useMemo(() => normalizeLogStats(health?.logs), [health])

  if (loading && !health) {
    return <LoadingHealthPanel />
  }

  if (!health) {
    return (
      <div className="app-workspace-content">
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error || '无法读取健康状态'}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void loadHealth()}>
          <RefreshCw data-icon="inline-start" />
          重新检测
        </Button>
      </div>
    )
  }

  const metrics = [
    {
      icon: Cpu,
      label: 'CPU',
      value: `${health.cpu.percent.toFixed(1)}%`,
      detail: `${health.cpu.cores} 核 · load ${health.cpu.loadAverage.map((item) => item.toFixed(2)).join(' / ')}`,
    },
    {
      icon: HardDrive,
      label: 'RSS 内存',
      value: formatBytes(health.memory.rss),
      detail: `Heap ${formatBytes(health.memory.heapUsed)} / ${formatBytes(health.memory.heapTotal)}`,
    },
    {
      icon: Network,
      label: 'TCP 连接',
      value: String(health.connections.total),
      detail: `代理 ${health.connections.proxySockets} · TLS ${health.connections.mitmTlsSockets} · WS ${health.connections.webSockets}`,
    },
    {
      icon: Server,
      label: 'MITM 服务',
      value: String(health.mitmServers.count),
      detail: `${health.mitmServers.activeSockets} 个活跃 socket`,
    },
    {
      icon: Terminal,
      label: '文件描述符',
      value: health.process.fdCount == null ? '-' : String(health.process.fdCount),
      detail: `handles ${health.process.activeHandles ?? '-'} · requests ${health.process.activeRequests ?? '-'}`,
    },
    {
      icon: Gauge,
      label: '事件循环',
      value: `${health.eventLoop.maxMs.toFixed(1)} ms`,
      detail: `mean ${health.eventLoop.meanMs.toFixed(1)} ms`,
    },
  ]

  return (
    <div className="app-workspace-content overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">运行健康</h2>
            <StatusBadge status={health.status} />
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>PID {health.pid}</span>
            <span>运行 {formatDuration(health.uptimeSec)}</span>
            <span>{health.platform}</span>
            <span>更新 {formatTime(health.generatedAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="自动刷新健康信息" />
            <span>自动刷新</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadHealth(true)} disabled={refreshing}>
            <RefreshCw data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>刷新失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <ListChecks />
              健康检查
            </CardTitle>
            <CardDescription>阈值来自当前进程的 MEDDLE_WATCHDOG 配置。</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>当前值</TableHead>
                  <TableHead>阈值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.checks.map((item) => (
                  <TableRow key={item.name}>
                    <TableCell className="font-medium">{CHECK_LABEL[item.name] || item.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>{formatCheckValue(item.value, item.unit)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatLimit(item.limit, item.unit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck />
              守护策略
            </CardTitle>
            <CardDescription>连续命中严重阈值后按策略处理。</CardDescription>
            <CardAction>
              <Badge variant={health.watchdog.config.enabled ? 'default' : 'secondary'}>
                {health.watchdog.config.enabled ? '已启用' : '已关闭'}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <KeyValue label="动作" value={health.watchdog.config.action === 'exit' ? '退出重启' : '仅告警'} />
            <KeyValue label="检测间隔" value={formatDuration(health.watchdog.config.intervalMs / 1000)} />
            <KeyValue label="最小运行时间" value={formatDuration(health.watchdog.config.minUptimeMs / 1000)} />
            <KeyValue label="失败阈值" value={`${health.watchdog.consecutiveFailures}/${health.watchdog.config.failureThreshold}`} />
            <KeyValue label="CPU 阈值" value={`${health.watchdog.config.cpuPercent}%`} />
            <KeyValue label="RSS 阈值" value={formatBytes(health.watchdog.config.rssBytes)} />
            <KeyValue label="连接阈值" value={String(health.watchdog.config.connectionCount)} />
            <KeyValue label="FD 阈值" value={String(health.watchdog.config.fdCount)} />
            {health.watchdog.lastReason && (
              <div className="sm:col-span-2">
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>最近命中</AlertTitle>
                  <AlertDescription>{health.watchdog.lastReason}</AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <Wifi />
              MITM 服务池
            </CardTitle>
            <CardDescription>{health.mitmServers.count} 个动态 HTTPS 服务。</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {health.mitmServers.items.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>端口</TableHead>
                    <TableHead>Socket</TableHead>
                    <TableHead>空闲</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.mitmServers.items.map((item) => (
                    <TableRow key={`${item.host}:${item.port ?? 'dynamic'}`}>
                      <TableCell className="max-w-[260px] truncate font-medium" title={item.host}>
                        {item.host}
                      </TableCell>
                      <TableCell>{item.port ?? '-'}</TableCell>
                      <TableCell>{item.activeSockets} / {item.webSockets} WS</TableCell>
                      <TableCell className="text-muted-foreground">{item.idleForMs == null ? '-' : formatDuration(item.idleForMs / 1000)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Server />
                  </EmptyMedia>
                  <EmptyTitle>暂无动态 HTTPS 服务</EmptyTitle>
                  <EmptyDescription>当前没有活跃的 MITM 目标。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <Clock />
              日志限流
            </CardTitle>
            <CardDescription>
              已抑制 {logStats?.suppressedTotal ?? 0} 条重复日志。
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {logStats && logStats.keys.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>级别</TableHead>
                    <TableHead>输出 / 抑制</TableHead>
                    <TableHead>最近</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logStats.keys.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="max-w-[260px] truncate font-medium" title={item.key}>
                        {item.key}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.level === 'error' ? 'destructive' : item.level === 'warn' ? 'secondary' : 'outline'}>
                          {item.level}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.emitted} / {item.suppressed}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(item.lastSeenAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Clock />
                  </EmptyMedia>
                  <EmptyTitle>暂无限流记录</EmptyTitle>
                  <EmptyDescription>当前没有被抑制的重复日志。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

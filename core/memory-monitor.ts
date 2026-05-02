import * as os from 'os'

export interface MemoryMonitorOptions {
    checkIntervalMs?: number      // Check interval, default 60000 (1 minute)
    warnThresholdMB?: number      // Warning threshold, default 300 MB
    criticalThresholdMB?: number  // Critical threshold, default 500 MB
    enableAutoGC?: boolean        // Auto GC on critical, default false
    logger?: {
        warn(message: string): void
        error(message: string): void
        info(message: string): void
    }
}

export interface MemoryStats {
    rss: number           // Resident Set Size in bytes
    heapTotal: number     // Total heap size in bytes
    heapUsed: number      // Used heap size in bytes
    external: number      // External memory in bytes
    arrayBuffers: number  // Array buffers in bytes
    status: 'ok' | 'warn' | 'critical'
    rssMB: number
    heapUsedMB: number
    systemTotalMB: number
    systemFreeMB: number
}

export interface MemoryMonitor {
    getStats(): MemoryStats
    start(): void
    stop(): void
    forceGC(): boolean
}

const DEFAULT_OPTIONS: Required<Omit<MemoryMonitorOptions, 'logger'>> = {
    checkIntervalMs: 60000,
    warnThresholdMB: 300,
    criticalThresholdMB: 500,
    enableAutoGC: false,
}

export function createMemoryMonitor(options: MemoryMonitorOptions = {}): MemoryMonitor {
    const config = { ...DEFAULT_OPTIONS, ...options }
    const logger = options.logger || console
    let intervalId: ReturnType<typeof setInterval> | null = null

    function getStats(): MemoryStats {
        const memUsage = process.memoryUsage()
        const systemTotal = os.totalmem()
        const systemFree = os.freemem()

        const rssMB = memUsage.rss / (1024 * 1024)
        let status: 'ok' | 'warn' | 'critical' = 'ok'

        if (rssMB >= config.criticalThresholdMB) {
            status = 'critical'
        } else if (rssMB >= config.warnThresholdMB) {
            status = 'warn'
        }

        return {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            status,
            rssMB: Math.round(rssMB * 100) / 100,
            heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024) * 100) / 100,
            systemTotalMB: Math.round(systemTotal / (1024 * 1024)),
            systemFreeMB: Math.round(systemFree / (1024 * 1024)),
        }
    }

    function check(): void {
        const stats = getStats()

        if (stats.status === 'critical') {
            logger.error(`[memory] Critical memory usage: ${stats.rssMB}MB RSS (threshold: ${config.criticalThresholdMB}MB)`)
            if (config.enableAutoGC && global.gc) {
                global.gc()
                logger.info('[memory] Triggered manual GC due to critical memory')
            }
        } else if (stats.status === 'warn') {
            logger.warn(`[memory] High memory usage: ${stats.rssMB}MB RSS (threshold: ${config.warnThresholdMB}MB)`)
        }
    }

    function start(): void {
        if (intervalId !== null) return
        intervalId = setInterval(check, config.checkIntervalMs)
        // Initial check
        check()
    }

    function stop(): void {
        if (intervalId !== null) {
            clearInterval(intervalId)
            intervalId = null
        }
    }

    function forceGC(): boolean {
        if (global.gc) {
            global.gc()
            return true
        }
        return false
    }

    return {
        getStats,
        start,
        stop,
        forceGC,
    }
}

/**
 * Format memory stats for display
 */
export function formatMemoryStats(stats: MemoryStats): string {
    return `Memory: RSS=${stats.rssMB}MB, Heap=${stats.heapUsedMB}MB/${Math.round(stats.heapTotal / (1024 * 1024))}MB, Status=${stats.status}, SystemFree=${stats.systemFreeMB}MB/${stats.systemTotalMB}MB`
}
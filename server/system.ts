import express, { Application } from 'express'

interface MemoryStats {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
    status: 'ok' | 'warn' | 'critical'
    rssMB: number
    heapUsedMB: number
    systemTotalMB: number
    systemFreeMB: number
}

export interface ServerContextWithSystem {
    memoryMonitor?: {
        getStats(): MemoryStats
        forceGC(): boolean
    }
    bodyCacheManager?: {
        getStats(): { totalSize: number; fileCount: number; oldestFile: number; maxCacheSize: number }
        cleanup(): { deletedCount: number; freedSize: number }
    }
    proxyRecordDetailMap: Map<number, unknown>
    MAX_BODY_SIZE?: number
    BODY_MEMORY_THRESHOLD?: number
    CACHE_DIR_MAX_SIZE?: number
    MAX_DETAIL_SIZE?: number
    MAX_RECORD_SIZE?: number
}

export function registerSystemRoutes(app: Application, serverContext: ServerContextWithSystem): void {
    const router = express.Router()

    // Get memory stats
    router.get('/memory', (_req, res) => {
        const stats = serverContext.memoryMonitor?.getStats()
        if (stats) {
            res.json(stats)
        } else {
            // Fallback: get raw process memory
            const memUsage = process.memoryUsage()
            const os = require('os')
            res.json({
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external,
                arrayBuffers: memUsage.arrayBuffers,
                status: 'ok',
                rssMB: Math.round(memUsage.rss / (1024 * 1024) * 100) / 100,
                heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024) * 100) / 100,
                systemTotalMB: Math.round(os.totalmem() / (1024 * 1024)),
                systemFreeMB: Math.round(os.freemem() / (1024 * 1024)),
            })
        }
    })

    // Get cache stats
    router.get('/cache', (_req, res) => {
        const cacheStats = serverContext.bodyCacheManager?.getStats()
        const memoryEntries = serverContext.proxyRecordDetailMap?.size || 0

        res.json({
            totalSize: cacheStats?.totalSize || 0,
            fileCount: cacheStats?.fileCount || 0,
            memoryEntries,
            maxCacheSize: serverContext.CACHE_DIR_MAX_SIZE || 500 * 1024 * 1024,
            oldestFile: cacheStats?.oldestFile || 0,
        })
    })

    // Get full system status
    router.get('/status', (_req, res) => {
        const memStats = serverContext.memoryMonitor?.getStats()
        const cacheStats = serverContext.bodyCacheManager?.getStats()

        res.json({
            memory: memStats || {
                rssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
                status: 'ok',
            },
            cache: {
                totalSize: cacheStats?.totalSize || 0,
                fileCount: cacheStats?.fileCount || 0,
                memoryEntries: serverContext.proxyRecordDetailMap?.size || 0,
                maxCacheSize: serverContext.CACHE_DIR_MAX_SIZE || 500 * 1024 * 1024,
            },
            config: {
                MAX_RECORD_SIZE: serverContext.MAX_RECORD_SIZE || 10000,
                MAX_DETAIL_SIZE: serverContext.MAX_DETAIL_SIZE || 200,
                MAX_BODY_SIZE: serverContext.MAX_BODY_SIZE || 5 * 1024 * 1024,
                BODY_MEMORY_THRESHOLD: serverContext.BODY_MEMORY_THRESHOLD || 100 * 1024,
                CACHE_DIR_MAX_SIZE: serverContext.CACHE_DIR_MAX_SIZE || 500 * 1024 * 1024,
            },
            uptime: process.uptime(),
            timestamp: Date.now(),
        })
    })

    // Trigger cache cleanup
    router.post('/cache/cleanup', (_req, res) => {
        const result = serverContext.bodyCacheManager?.cleanup()
        res.json({
            success: true,
            deletedCount: result?.deletedCount || 0,
            freedSize: result?.freedSize || 0,
        })
    })

    // Force garbage collection (requires --expose-gc flag)
    router.post('/gc', (_req, res) => {
        if (global.gc) {
            global.gc()
            res.json({ success: true, message: 'Garbage collection triggered' })
        } else {
            res.json({
                success: false,
                message: 'GC not available. Run node with --expose-gc flag',
            })
        }
    })

    app.use('/api/system', router)
}
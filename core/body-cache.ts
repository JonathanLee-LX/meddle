import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface BodyCacheOptions {
    cacheDir?: string                // Cache directory, default ~/.ep/cache/bodies
    maxCacheSize?: number            // Max cache size in bytes, default 500MB
    memoryThreshold?: number         // Threshold for storing in memory vs file, default 100KB
    cleanupThreshold?: number        // Trigger cleanup at this ratio (0.8 = 80%)
    cleanupRatio?: number            // Cleanup this ratio of files when triggered (0.3 = 30%)
    maxDetailSize?: number           // Max detail entries, default 200
}

export interface BodyStoreResult {
    inMemory: boolean
    path?: string
    size: number
}

export interface CacheStats {
    totalSize: number      // Total cache size in bytes
    fileCount: number      // Number of cached files
    oldestFile: number     // Timestamp of oldest file
    memoryEntries: number  // Number of entries stored in memory
    maxCacheSize: number   // Configured max size
}

export interface CachedBody {
    recordId: number
    type: 'request' | 'response'
    contentType: string
    encoding: 'utf8' | 'base64'
    size: number
    storedAt: number
    data: string
}

interface FileEntry {
    path: string
    size: number
    storedAt: number
    recordId: number
}

const DEFAULT_OPTIONS: Required<BodyCacheOptions> = {
    cacheDir: '',
    maxCacheSize: 500 * 1024 * 1024,   // 500MB
    memoryThreshold: 100 * 1024,        // 100KB
    cleanupThreshold: 0.8,
    cleanupRatio: 0.3,
    maxDetailSize: 200,
}

export function createBodyCache(options: BodyCacheOptions = {}): {
    storeBody: (recordId: number, type: 'request' | 'response', data: string, contentType: string) => BodyStoreResult
    readBody: (recordId: number, type: 'request' | 'response', memoryData?: string) => string | null
    deleteBody: (recordId: number) => void
    getStats: () => CacheStats
    cleanup: () => { deletedCount: number; freedSize: number }
    cleanupOrphaned: (activeRecordIds: Set<number>) => { deletedCount: number; freedSize: number }
    getMemoryThreshold: () => number
} {
    const config = { ...DEFAULT_OPTIONS, ...options }

    // Resolve cache directory
    const epDir = path.resolve(os.homedir(), '.ep')
    const cacheDir = config.cacheDir || path.resolve(epDir, 'cache', 'bodies')

    // Ensure cache directory exists
    function ensureCacheDir(): void {
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true })
        }
    }

    // Get file path for a record
    function getFilePath(recordId: number, type: 'request' | 'response'): string {
        return path.resolve(cacheDir, `${recordId}-${type}.body`)
    }

    // Determine encoding from content type
    function getEncoding(contentType: string): 'utf8' | 'base64' {
        if (contentType.includes('application/json') ||
            contentType.includes('text/') ||
            contentType.includes('application/xml')) {
            return 'utf8'
        }
        return 'base64'
    }

    // Encode data for storage
    function encodeData(data: string, encoding: 'utf8' | 'base64'): string {
        if (encoding === 'base64') {
            // If data is already base64 encoded, keep it
            if (data.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(data.substring(0, 100))) {
                return data
            }
            return Buffer.from(data).toString('base64')
        }
        return data
    }

    // List all cached files with metadata
    function listCachedFiles(): FileEntry[] {
        ensureCacheDir()
        const files: FileEntry[] = []

        try {
            const entries = fs.readdirSync(cacheDir)
            for (const entry of entries) {
                if (!entry.endsWith('.body')) continue

                const filePath = path.resolve(cacheDir, entry)
                try {
                    const stat = fs.statSync(filePath)
                    const match = entry.match(/^(\d+)-(request|response)\.body$/)
                    if (match) {
                        files.push({
                            path: filePath,
                            size: stat.size,
                            storedAt: stat.mtimeMs,
                            recordId: parseInt(match[1], 10),
                        })
                    }
                } catch {
                    // Skip unreadable files
                }
            }
        } catch {
            // Directory not accessible
        }

        return files.sort((a, b) => a.storedAt - b.storedAt)  // Oldest first
    }

    // Calculate total cache size
    function calculateTotalSize(): number {
        const files = listCachedFiles()
        return files.reduce((sum, f) => sum + f.size, 0)
    }

    // Check if cleanup is needed and perform it
    function checkAndCleanup(): void {
        const totalSize = calculateTotalSize()
        if (totalSize >= config.maxCacheSize * config.cleanupThreshold) {
            cleanup()
        }
    }

    // Store body - returns storage info
    function storeBody(
        recordId: number,
        type: 'request' | 'response',
        data: string,
        contentType: string
    ): BodyStoreResult {
        const size = Buffer.byteLength(data, 'utf8')

        // Small bodies stay in memory
        if (size < config.memoryThreshold) {
            return { inMemory: true, size }
        }

        // Large bodies go to file cache
        ensureCacheDir()
        const filePath = getFilePath(recordId, type)
        const encoding = getEncoding(contentType)
        const encodedData = encodeData(data, encoding)

        const cachedBody: CachedBody = {
            recordId,
            type,
            contentType,
            encoding,
            size,
            storedAt: Date.now(),
            data: encodedData,
        }

        try {
            fs.writeFileSync(filePath, JSON.stringify(cachedBody), 'utf8')
            checkAndCleanup()
            return { inMemory: false, path: filePath, size }
        } catch (err: any) {
            // Fallback to memory if file write fails
            console.error(`[body-cache] Failed to write cache file:`, err.message)
            return { inMemory: true, size }
        }
    }

    // Read body - from memory or file
    function readBody(
        recordId: number,
        type: 'request' | 'response',
        memoryData?: string
    ): string | null {
        // If memory data provided, return it directly
        if (memoryData !== undefined) {
            return memoryData
        }

        // Try to read from cache file
        const filePath = getFilePath(recordId, type)
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8')
                const cachedBody: CachedBody = JSON.parse(content)
                return cachedBody.data
            }
        } catch (err: any) {
            console.error(`[body-cache] Failed to read cache file:`, err.message)
        }

        return null
    }

    // Delete cached files for a record
    function deleteBody(recordId: number): void {
        const requestPath = getFilePath(recordId, 'request')
        const responsePath = getFilePath(recordId, 'response')

        try {
            if (fs.existsSync(requestPath)) {
                fs.unlinkSync(requestPath)
            }
        } catch { /* ignore */ }

        try {
            if (fs.existsSync(responsePath)) {
                fs.unlinkSync(responsePath)
            }
        } catch { /* ignore */ }
    }

    // Get cache statistics
    function getStats(): CacheStats {
        const files = listCachedFiles()
        const totalSize = files.reduce((sum, f) => sum + f.size, 0)
        const oldestFile = files.length > 0 ? files[0].storedAt : 0

        return {
            totalSize,
            fileCount: files.length,
            oldestFile,
            memoryEntries: 0,  // This is tracked externally in proxyRecordDetailMap
            maxCacheSize: config.maxCacheSize,
        }
    }

    // Cleanup - delete oldest files to free space
    function cleanup(): { deletedCount: number; freedSize: number } {
        const files = listCachedFiles()
        if (files.length === 0) return { deletedCount: 0, freedSize: 0 }

        const targetCount = Math.ceil(files.length * config.cleanupRatio)
        const toDelete = files.slice(0, targetCount)

        let deletedCount = 0
        let freedSize = 0

        for (const entry of toDelete) {
            try {
                fs.unlinkSync(entry.path)
                deletedCount++
                freedSize += entry.size
            } catch { /* ignore */ }
        }

        if (deletedCount > 0) {
            console.log(`[body-cache] Cleanup: deleted ${deletedCount} files, freed ${Math.round(freedSize / 1024)}KB`)
        }

        return { deletedCount, freedSize }
    }

    // Cleanup orphaned files - files without corresponding active records
    function cleanupOrphaned(activeRecordIds: Set<number>): { deletedCount: number; freedSize: number } {
        const files = listCachedFiles()
        let deletedCount = 0
        let freedSize = 0

        for (const entry of files) {
            if (!activeRecordIds.has(entry.recordId)) {
                try {
                    fs.unlinkSync(entry.path)
                    deletedCount++
                    freedSize += entry.size
                } catch { /* ignore */ }
            }
        }

        if (deletedCount > 0) {
            console.log(`[body-cache] Orphaned cleanup: deleted ${deletedCount} files, freed ${Math.round(freedSize / 1024)}KB`)
        }

        return { deletedCount, freedSize }
    }

    function getMemoryThreshold(): number {
        return config.memoryThreshold
    }

    return {
        storeBody,
        readBody,
        deleteBody,
        getStats,
        cleanup,
        cleanupOrphaned,
        getMemoryThreshold,
    }
}
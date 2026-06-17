export interface RateLimitedLogEvent {
    key: string
    level: 'error' | 'warn' | 'info' | 'log'
    windowStartedAt: number
    firstSeenAt: number
    lastSeenAt: number
    emitted: number
    suppressed: number
}

export interface RateLimitedLogger {
    error(key: string, ...args: unknown[]): void
    warn(key: string, ...args: unknown[]): void
    info(key: string, ...args: unknown[]): void
    log(key: string, ...args: unknown[]): void
    getStats(): {
        windowMs: number
        maxPerWindow: number
        keys: RateLimitedLogEvent[]
        suppressedTotal: number
    }
}

interface LoggerLike {
    error(...args: unknown[]): void
    warn(...args: unknown[]): void
    info(...args: unknown[]): void
    log(...args: unknown[]): void
}

export function createRateLimitedLogger(
    logger: LoggerLike = console,
    options: { windowMs?: number; maxPerWindow?: number; now?: () => number } = {},
): RateLimitedLogger {
    const windowMs = Math.max(1000, options.windowMs || 60000)
    const maxPerWindow = Math.max(1, options.maxPerWindow || 20)
    const now = options.now || Date.now
    const events = new Map<string, RateLimitedLogEvent>()

    function emit(level: RateLimitedLogEvent['level'], key: string, args: unknown[]): void {
        const current = now()
        const existing = events.get(key)
        const event = existing && current - existing.windowStartedAt < windowMs
            ? existing
            : {
                key,
                level,
                windowStartedAt: current,
                firstSeenAt: existing?.firstSeenAt || current,
                lastSeenAt: current,
                emitted: 0,
                suppressed: 0,
            }

        event.level = level
        event.lastSeenAt = current
        events.set(key, event)

        if (event.emitted < maxPerWindow) {
            event.emitted += 1
            logger[level](...args)
            return
        }

        event.suppressed += 1
        if (event.suppressed === 1) {
            logger[level](`[rate-limited] suppressing repeated log: ${key}`)
        }
    }

    return {
        error(key, ...args) { emit('error', key, args) },
        warn(key, ...args) { emit('warn', key, args) },
        info(key, ...args) { emit('info', key, args) },
        log(key, ...args) { emit('log', key, args) },
        getStats() {
            const keys = Array.from(events.values())
            return {
                windowMs,
                maxPerWindow,
                keys,
                suppressedTotal: keys.reduce((sum, event) => sum + event.suppressed, 0),
            }
        },
    }
}

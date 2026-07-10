import { describe, expect, it } from 'vitest'
import { createRateLimitedLogger } from '../core/log-rate-limit'

describe('createRateLimitedLogger', () => {
    it('suppresses repeated logs after the configured window limit', () => {
        const errors: unknown[][] = []
        const logger = createRateLimitedLogger({
            error: (...args: unknown[]) => { errors.push(args) },
            warn: () => {},
            info: () => {},
            log: () => {},
        }, { windowMs: 1000, maxPerWindow: 2, now: () => 100 })

        logger.error('same-error', 'first')
        logger.error('same-error', 'second')
        logger.error('same-error', 'third')
        logger.error('same-error', 'fourth')

        expect(errors).toHaveLength(3)
        expect(errors[2][0]).toContain('[rate-limited]')
        expect(logger.getStats().suppressedTotal).toBe(2)
    })
})

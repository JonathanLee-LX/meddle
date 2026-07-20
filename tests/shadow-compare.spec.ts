import { describe, it, expect } from 'vitest'
import { createShadowCompareTracker } from '../core/shadow-compare'

describe('shadow compare tracker', () => {
    it('records same and diff counts', () => {
        const tracker = createShadowCompareTracker({ maxSamples: 2 })
        const a = tracker.record({
            source: 'https://a.com',
            baseTarget: 'https://a.com',
            observedTarget: 'https://a.com',
            method: 'GET',
        })
        const b = tracker.record({
            source: 'https://b.com',
            baseTarget: 'https://a.com',
            observedTarget: 'https://b.com',
            method: 'GET',
        })
        expect(a).toBe(false)
        expect(b).toBe(true)

        const stats = tracker.getStats()
        expect(stats.total).toBe(2)
        expect(stats.same).toBe(1)
        expect(stats.diff).toBe(1)
        expect(stats.diffRate).toBe(0.5)
        expect(stats.samples.length).toBe(1)
        expect(stats.uniqueDiffPairs).toBe(1)
        expect(stats.topDiffs.length).toBe(1)
        expect(stats.topDiffs[0].count).toBe(1)
    })

    it('keeps only latest diff samples by maxSamples', () => {
        const tracker = createShadowCompareTracker({ maxSamples: 2 })
        tracker.record({ source: '1', baseTarget: 'a', observedTarget: 'b', method: 'GET' })
        tracker.record({ source: '2', baseTarget: 'a', observedTarget: 'c', method: 'GET' })
        tracker.record({ source: '3', baseTarget: 'a', observedTarget: 'd', method: 'GET' })

        const stats = tracker.getStats()
        expect(stats.samples.length).toBe(2)
        expect(stats.samples[0].source).toBe('2')
        expect(stats.samples[1].source).toBe('3')
    })

    it('aggregates repeated diff pairs into topDiffs', () => {
        const tracker = createShadowCompareTracker({ maxSamples: 10, maxTopDiffs: 3 })
        tracker.record({ source: '1', baseTarget: 'a', observedTarget: 'b', method: 'GET' })
        tracker.record({ source: '2', baseTarget: 'a', observedTarget: 'b', method: 'GET' })
        tracker.record({ source: '3', baseTarget: 'a', observedTarget: 'c', method: 'GET' })

        const stats = tracker.getStats()
        expect(stats.uniqueDiffPairs).toBe(2)
        expect(stats.topDiffs[0].baseTarget).toBe('a')
        expect(stats.topDiffs[0].observedTarget).toBe('b')
        expect(stats.topDiffs[0].count).toBe(2)
    })

    it('supports reset', () => {
        const tracker = createShadowCompareTracker()
        tracker.record({ source: '1', baseTarget: 'a', observedTarget: 'b', method: 'GET' })
        tracker.reset()
        const stats = tracker.getStats()
        expect(stats.total).toBe(0)
        expect(stats.diff).toBe(0)
        expect(stats.uniqueDiffPairs).toBe(0)
        expect(stats.samples.length).toBe(0)
    })
})

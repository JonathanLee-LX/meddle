import { describe, expect, it } from 'vitest'
import { isStreamingResponse } from '../core/streaming-response'

describe('isStreamingResponse', () => {
    it('recognizes event-stream responses with parameters', () => {
        expect(isStreamingResponse({ 'content-type': 'text/event-stream; charset=utf-8' })).toBe(true)
    })

    it('recognizes common streaming JSON media types', () => {
        expect(isStreamingResponse({ 'Content-Type': 'application/x-ndjson' })).toBe(true)
        expect(isStreamingResponse({ 'content-type': 'application/stream+json' })).toBe(true)
    })

    it('does not classify ordinary JSON responses as streaming', () => {
        expect(isStreamingResponse({ 'content-type': 'application/json' })).toBe(false)
        expect(isStreamingResponse({})).toBe(false)
    })
})

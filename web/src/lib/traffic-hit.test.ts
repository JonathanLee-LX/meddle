import { describe, expect, it } from 'vitest'
import { getTrafficHitSummary } from './traffic-hit'

describe('traffic-hit display summary', () => {
  it('labels mock rows', () => {
    const hit = getTrafficHitSummary({
      mock: true,
      source: 'https://a.example/x',
      target: 'https://a.example/x',
    })
    expect(hit.kind).toBe('mock')
    expect(hit.badge).toBe('Mock')
  })

  it('labels rewrite as rule', () => {
    const hit = getTrafficHitSummary({
      source: 'https://api.example/cart',
      target: 'https://staging.example/cart',
    })
    expect(hit.kind).toBe('rule')
    expect(hit.badge).toBe('Rule')
  })

  it('labels passthrough', () => {
    const hit = getTrafficHitSummary({
      source: 'https://cdn.example/a.js',
      target: 'https://cdn.example/a.js',
    })
    expect(hit.kind).toBe('pass')
    expect(hit.badge).toBe('—')
  })
})

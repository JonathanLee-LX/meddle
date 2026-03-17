import { describe, expect, it } from 'vitest'
import { dedupeMockRules, upsertMockRule } from './use-mocks'
import type { MockRule } from '@/types'

const baseRule = (id: number, name: string): MockRule => ({
  id,
  name,
  urlPattern: `/api/${name}`,
  method: 'GET',
  statusCode: 200,
  delay: 0,
  bodyType: 'inline',
  headers: {},
  body: '',
  enabled: true,
})

describe('use-mocks helpers', () => {
  it('dedupeMockRules keeps one rule per id', () => {
    const rules = [
      baseRule(1, 'first'),
      baseRule(2, 'second'),
      { ...baseRule(1, 'first-updated'), statusCode: 201 },
    ]

    expect(dedupeMockRules(rules)).toEqual([
      { ...baseRule(1, 'first-updated'), statusCode: 201 },
      baseRule(2, 'second'),
    ])
  })

  it('upsertMockRule replaces an existing rule instead of appending a duplicate', () => {
    const existing = [
      baseRule(1, 'first'),
      baseRule(2, 'second'),
    ]

    expect(upsertMockRule(existing, { ...baseRule(2, 'second-updated'), delay: 300 })).toEqual([
      baseRule(1, 'first'),
      { ...baseRule(2, 'second-updated'), delay: 300 },
    ])
  })
})

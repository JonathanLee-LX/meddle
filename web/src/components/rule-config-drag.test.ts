import { describe, expect, it } from 'vitest'
import {
  getRuleFileTabOrder,
  getRuleRowOrder,
  reorderItemsByRowIds,
  resolveRuleFileTabOrder,
  syncActiveRuleFilesToTabOrder,
} from '@/lib/rule-order'

describe('rule table drag ordering', () => {
  it('moves the active row id to the hovered row position', () => {
    expect(getRuleRowOrder(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(getRuleRowOrder(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('keeps the current order when drag ids are missing or unchanged', () => {
    const rowIds = ['a', 'b', 'c']

    expect(getRuleRowOrder(rowIds, 'a', 'a')).toBe(rowIds)
    expect(getRuleRowOrder(rowIds, 'x', 'b')).toBe(rowIds)
    expect(getRuleRowOrder(rowIds, 'a', null)).toBe(rowIds)
  })

  it('reorders items by stable row ids instead of array indexes', () => {
    const items = ['first', 'second', 'third']
    const rowIds = ['row-10', 'row-20', 'row-30']
    const orderedRowIds = ['row-20', 'row-30', 'row-10']

    expect(reorderItemsByRowIds(items, rowIds, orderedRowIds)).toEqual(['second', 'third', 'first'])
  })
})

describe('rule file tab drag ordering', () => {
  it('reorders tab ids like rule rows', () => {
    expect(getRuleFileTabOrder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(getRuleFileTabOrder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('keeps enabled merge order aligned with tab relative order', () => {
    expect(syncActiveRuleFilesToTabOrder(['a', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'a'])
    expect(syncActiveRuleFilesToTabOrder(['b'], ['a', 'b', 'c'])).toEqual(['b'])
  })

  it('seeds tab order from active files when no stored order exists', () => {
    expect(resolveRuleFileTabOrder(['disk-a', 'disk-b', 'disk-c'], [], ['disk-c', 'disk-a'])).toEqual([
      'disk-c',
      'disk-a',
      'disk-b',
    ])
  })

  it('prefers persisted tab order and appends newly discovered files', () => {
    expect(resolveRuleFileTabOrder(['a', 'b', 'c'], ['b', 'a'], ['a'])).toEqual(['b', 'a', 'c'])
  })
})

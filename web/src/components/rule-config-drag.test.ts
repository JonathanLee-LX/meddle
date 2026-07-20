import { describe, expect, it } from 'vitest'
import { getRuleRowOrder, reorderItemsByRowIds } from './rule-config'

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

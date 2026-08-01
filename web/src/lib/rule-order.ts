import { arrayMove } from '@dnd-kit/sortable'

export function getRuleRowOrder(rowIds: string[], activeId: string | number, overId: string | number | null | undefined): string[] {
  if (overId == null) return rowIds

  const activeKey = String(activeId)
  const overKey = String(overId)
  if (activeKey === overKey) return rowIds

  const oldIndex = rowIds.indexOf(activeKey)
  const newIndex = rowIds.indexOf(overKey)
  if (oldIndex < 0 || newIndex < 0) return rowIds

  return arrayMove(rowIds, oldIndex, newIndex)
}

export function reorderItemsByRowIds<T>(items: T[], rowIds: string[], orderedRowIds: string[]): T[] {
  if (items.length !== rowIds.length || rowIds.length !== orderedRowIds.length) return items

  const itemById = new Map(rowIds.map((id, index) => [id, items[index]]))
  if (orderedRowIds.some((id) => !itemById.has(id))) return items

  return orderedRowIds.map((id) => itemById.get(id) as T)
}

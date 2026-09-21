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

/** Reorder rule-file tab ids after a dnd-kit drag (same semantics as rule rows). */
export function getRuleFileTabOrder(
  fileNames: string[],
  activeId: string | number,
  overId: string | number | null | undefined,
): string[] {
  return getRuleRowOrder(fileNames, activeId, overId)
}

/** Enabled-file merge order follows their relative order in the tab bar. */
export function syncActiveRuleFilesToTabOrder(activeNames: string[], tabOrder: string[]): string[] {
  const activeSet = new Set(activeNames)
  const synced = tabOrder.filter((name) => activeSet.has(name))
  for (const name of activeNames) {
    if (!synced.includes(name)) synced.push(name)
  }
  return synced
}

/**
 * Resolve display order: prefer persisted order; when empty, seed with active
 * names first (preserve merge order) then remaining disk names.
 */
export function resolveRuleFileTabOrder(
  diskNames: string[],
  storedOrder: string[],
  activeNames: string[],
): string[] {
  const diskSet = new Set(diskNames)
  const ordered: string[] = []
  const seen = new Set<string>()

  const pushUnique = (name: string) => {
    if (!diskSet.has(name) || seen.has(name)) return
    ordered.push(name)
    seen.add(name)
  }

  if (storedOrder.length > 0) {
    for (const name of storedOrder) pushUnique(name)
  } else {
    for (const name of activeNames) pushUnique(name)
  }

  for (const name of diskNames) pushUnique(name)
  return ordered
}

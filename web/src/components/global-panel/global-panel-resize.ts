/**
 * Request detail docks a wrapping action bar along the bottom of the overlay.
 * Lift the handle above that bar. Other global panels have no bar, so keep
 * the handle in the bottom-right corner.
 */
export function globalPanelResizeHandleOffsetClass(routeId: string): string {
  return routeId === 'request.detail' ? 'bottom-12 right-1' : 'bottom-0 right-0'
}

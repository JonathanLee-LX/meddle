export function getSaveShortcutLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl+S'
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘S' : 'Ctrl+S'
}

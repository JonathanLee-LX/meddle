type NavigatorWithClientHints = Navigator & {
  userAgentData?: { platform?: string }
}

/** Apple platforms use Command; other desktops use Control. */
export function isApplePlatform(nav: Navigator | undefined = globalThis.navigator) {
  if (!nav) return false
  const hinted = (nav as NavigatorWithClientHints).userAgentData?.platform
  if (hinted) return /macOS|iOS|iPadOS/i.test(hinted)
  const platform = nav.platform || ''
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return true
  return /Mac OS|iPhone|iPad|iPod/i.test(nav.userAgent || '')
}

export function getSaveShortcutLabel(nav?: Navigator) {
  return isApplePlatform(nav) ? '⌘+S' : 'Ctrl+S'
}

export function getSaveShortcutAria(nav?: Navigator) {
  return isApplePlatform(nav) ? 'Meta+S' : 'Control+S'
}

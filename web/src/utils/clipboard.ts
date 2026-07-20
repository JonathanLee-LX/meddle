const CLIPBOARD_WRITE_TIMEOUT = 750

function writeClipboardText(text: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('写入剪贴板超时'))
    }, CLIPBOARD_WRITE_TIMEOUT)

    navigator.clipboard.writeText(text).then(
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function restoreSelection(activeElement: HTMLElement | null, selectedRange: Range | null) {
  activeElement?.focus()

  if (!selectedRange) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(selectedRange)
}

function copyTextWithSelection(text: string) {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const textarea = document.createElement('textarea')

  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto 0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    if (!document.execCommand('copy')) {
      throw new Error('浏览器未允许复制到剪贴板')
    }
  } finally {
    textarea.remove()
    restoreSelection(activeElement, selectedRange)
  }
}

export async function copyText(text: string) {
  let clipboardError: unknown

  if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
    try {
      await writeClipboardText(text)
      return
    } catch (error) {
      clipboardError = error
      // Embedded browsers can expose Clipboard API while rejecting writes.
    }
  }

  try {
    copyTextWithSelection(text)
  } catch (fallbackError) {
    throw new Error('浏览器未允许复制到剪贴板', {
      cause: clipboardError || fallbackError,
    })
  }
}

import { describe, expect, it, vi, afterEach } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error cleanup
  delete navigator.clipboard
})

describe('copyText fallback', () => {
  it('uses navigator.clipboard when available in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    await copyText('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('skips the clipboard API in a non-secure context and falls back synchronously (keeps user gesture)', async () => {
    // 远程 LAN-IP (http) 是非安全上下文: clipboard 即使存在也受限,
    // await writeText 会丢失用户手势, 导致 execCommand 降级失败。
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {})

    await copyText('lan-content')

    expect(writeText).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledWith('copy')
    expect(select).toHaveBeenCalled()
  })

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    // jsdom 默认无 clipboard — 走降级
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {})
    await copyText('fallback-content')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(select).toHaveBeenCalled()
  })

  it('appends the fallback textarea inside an open dialog (radix FocusScope keeps focus in-dialog)', async () => {
    // Sheet/Dialog 场景: body 上的 textarea 会被 FocusScope 拉回焦点,
    // execCommand 复制空内容。textarea 必须挂到 dialog 容器内。
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(function (this: HTMLTextAreaElement) {
      this.setSelectionRange(0, this.value.length)
    })

    // 模拟 radix dialog 结构: activeElement 在 [role=dialog] 内
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    const btn = document.createElement('button')
    dialog.appendChild(btn)
    btn.focus()

    const appendChild = vi.spyOn(dialog, 'appendChild')

    await copyText('dialog-content')

    // textarea 应被 append 到 dialog 容器内（appendChild 被调用）
    expect(appendChild).toHaveBeenCalled()
    const appended = appendChild.mock.calls[0][0] as HTMLTextAreaElement
    expect(appended.tagName).toBe('TEXTAREA')
    expect(appended.value).toBe('dialog-content')
    dialog.remove()
  })

  it('throws a clear error when both clipboard and execCommand fail', async () => {
    // clipboard 不存在，execCommand 返回 false
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const exec = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await expect(copyText('x')).rejects.toThrow(/复制/)
  })
})


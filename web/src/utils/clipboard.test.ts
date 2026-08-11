import { describe, expect, it, vi, afterEach } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error cleanup
  delete navigator.clipboard
})

describe('copyText fallback', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await copyText('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    // jsdom 默认无 clipboard — 走降级
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {})
    await copyText('fallback-content')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(select).toHaveBeenCalled()
  })

  it('throws a clear error when both clipboard and execCommand fail', async () => {
    // clipboard 不存在，execCommand 返回 false
    const exec = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await expect(copyText('x')).rejects.toThrow(/复制/)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('copyText', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await copyText('https://example.test/setup')

    expect(writeText).toHaveBeenCalledWith('https://example.test/setup')
  })

  it('falls back to selection copy when Clipboard API is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    const execCommand = vi.fn().mockImplementation(() => {
      expect(document.querySelector('textarea')).toHaveValue('https://example.test/setup')
      return true
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    await copyText('https://example.test/setup')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).not.toBeInTheDocument()
  })

  it('falls back when Clipboard API does not settle', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => new Promise<void>(() => {}))
    const execCommand = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    const copyPromise = copyText('https://example.test/setup')
    await vi.advanceTimersByTimeAsync(1000)
    await copyPromise

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('reports a failure when neither copy method succeeds', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })

    await expect(copyText('https://example.test/setup'))
      .rejects.toThrow('浏览器未允许复制到剪贴板')
  })
})

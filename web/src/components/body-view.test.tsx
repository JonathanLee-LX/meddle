import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyableJsonBody, CopyableHeaders } from './body-view'
import { formatHeadersText } from '@/utils/headers'
import { copyText } from '@/utils/clipboard'
import { toast } from '@/components/ui/toast'

vi.mock('@/utils/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(copyText).mockResolvedValue(undefined)
})

describe('formatHeadersText', () => {
  it('serializes headers to "key: value" lines', () => {
    expect(formatHeadersText({ 'content-type': 'application/json', 'x-custom': 'v' }))
      .toBe('content-type: application/json\nx-custom: v')
  })

  it('handles empty headers', () => {
    expect(formatHeadersText({})).toBe('')
    expect(formatHeadersText(undefined)).toBe('')
  })
})

describe('CopyableJsonBody', () => {
  it('renders a tab switch for JSON bodies (source vs formatted)', () => {
    render(<CopyableJsonBody body={'{"a":1,"b":[1,2]}'} />)
    expect(screen.getByText('源数据')).toBeTruthy()
    expect(screen.getByText('格式化')).toBeTruthy()
  })

  it('shows pretty-printed JSON in formatted mode', async () => {
    const user = userEvent.setup()
    render(<CopyableJsonBody body={'{"a":1,"b":[1,2]}'} />)
    await user.click(screen.getByRole('tab', { name: '格式化' }))
    const pre = document.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.textContent).toContain('{\n  "a": 1')
    expect(pre!.textContent).toContain('"b": [\n    1,\n    2\n  ]')
  })

  it('falls back to plain text for non-JSON bodies (no tab switch)', () => {
    render(<CopyableJsonBody body={'plain text body'} />)
    expect(screen.queryByText('格式化')).toBeNull()
    expect(screen.getByText(/plain text body/)).toBeTruthy()
  })

  it('shows placeholder for empty body', () => {
    render(<CopyableJsonBody body={''} />)
    expect(screen.getByText('无内容')).toBeTruthy()
  })

  it('copies the raw body when the copy button is clicked', async () => {
    const user = userEvent.setup()
    render(<CopyableJsonBody body={'{"a":1}'} />)
    const copyBtn = screen.getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('复制'))
    expect(copyBtn).toBeTruthy()
    await user.click(copyBtn!)
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('{"a":1}'))
  })

  it('shows a copied confirmation after a successful copy', async () => {
    const user = userEvent.setup()
    render(<CopyableJsonBody body={'{"a":1}'} />)
    const copyBtn = screen.getByRole('button', { name: /复制Body/ })
    await user.click(copyBtn)
    await screen.findByRole('button', { name: /复制Body成功/ })
    expect(screen.getByText('已复制')).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('已复制Body')
  })

  it('shows an error toast when copy fails', async () => {
    const user = userEvent.setup()
    vi.mocked(copyText).mockRejectedValueOnce(new Error('clipboard denied'))
    render(<CopyableJsonBody body={'{"a":1}'} />)
    const copyBtn = screen.getByRole('button', { name: /复制Body/ })
    await user.click(copyBtn)
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('复制Body失败，请手动选择复制'))
    expect(screen.getByRole('button', { name: /复制Body/ })).toBeTruthy() // state unchanged
  })
})

describe('CopyableHeaders', () => {
  it('renders header key/value pairs', () => {
    render(<CopyableHeaders headers={{ 'content-type': 'application/json' }} />)
    expect(screen.getByText('content-type:')).toBeTruthy()
    expect(screen.getByText('application/json')).toBeTruthy()
  })

  it('copies serialized headers when the copy button is clicked', async () => {
    const user = userEvent.setup()
    render(<CopyableHeaders headers={{ a: '1', b: '2' }} />)
    const copyBtn = screen.getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('复制'))
    expect(copyBtn).toBeTruthy()
    await user.click(copyBtn!)
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('a: 1\nb: 2'))
  })

  it('shows placeholder for empty headers', () => {
    render(<CopyableHeaders headers={{}} />)
    expect(screen.getByText('无头部信息')).toBeTruthy()
  })
})

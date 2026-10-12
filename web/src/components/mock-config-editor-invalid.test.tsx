import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MockConfig } from './mock-config'
import { useMocks } from '@/hooks/use-mocks'
import { toast } from '@/components/ui/toast'
import type { MockRule } from '@/types'

vi.mock('./monaco-editor', () => ({
  MonacoEditor: () => <div data-testid="mock-body-editor" />,
}))

/**
 * Issue #123: the mocks file breaks while the editor is open. The editor must
 * stay open with the user's input, show an inline notice, disable 「保存」, and
 * recover automatically once the file is fixed.
 */
const rule: MockRule = {
  id: 1, name: 'cart', urlPattern: '/cart/items', query: '', method: 'GET', statusCode: 200, delay: 0,
  bodyType: 'inline', headers: {}, body: '{}', enabled: true,
}
const badPath = '/tmp/meddle/mocks.json'
const VALID = { path: badPath, exists: true, custom: false, valid: true, parseError: null }
const INVALID = { path: badPath, exists: true, custom: false, valid: false, parseError: { line: 5, column: 3, message: 'Unexpected token ]' } }

function stubServer() {
  const state = { invalid: false, puts: [] as unknown[] }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'
    if (url === '/api/mocks-file') return json(state.invalid ? INVALID : VALID)
    if (url === '/api/mocks' && method === 'GET') return json(state.invalid ? [] : [rule])
    if (url.startsWith('/api/mocks') && (method === 'PUT' || method === 'POST')) {
      if (state.invalid) return json({ error: `Mock 文件格式错误，已禁止写入以免覆盖: ${badPath}`, code: 'MOCKS_FILE_INVALID' }, 409)
      const body = JSON.parse(String(init?.body))
      state.puts.push(body)
      return json({ status: 'success', rule: { ...rule, ...body, id: 1 } })
    }
    return json({})
  }))
  return state
}

function Harness() {
  const m = useMocks()
  return (
    <div style={{ height: 600 }}>
      <MockConfig {...m} />
    </div>
  )
}

const saveButton = () => screen.getByRole('button', { name: /保存/ })

describe('Mock editor while the mocks file is broken (issue #123)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('409 on save keeps the editor open with the input, inline notice, no toast; recovers after fix', async () => {
    const state = stubServer()
    const toastError = vi.spyOn(toast, 'error')
    render(<Harness />)
    fireEvent.click(await screen.findByText('/cart/items'))
    const input = await screen.findByDisplayValue('cart')
    fireEvent.change(input, { target: { value: 'cart-edited' } })

    // file breaks on disk; the watcher has not told this tab yet
    state.invalid = true
    await act(async () => { fireEvent.click(saveButton()) })

    const notice = await screen.findByTestId('mock-editor-file-invalid')
    expect(notice).toHaveTextContent('Mock 文件格式错误，修复后才能保存')
    expect(notice).toHaveTextContent('第 5 行第 3 列：Unexpected token ]')
    expect(notice).toHaveClass('text-xs', 'text-destructive')
    expect(toastError).not.toHaveBeenCalled()
    // editor still open, input preserved and editable, save disabled with tooltip label
    const nameInput = screen.getByDisplayValue('cart-edited') as HTMLInputElement
    expect(nameInput).not.toBeDisabled()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByTestId('mock-editor-save-wrapper')).toHaveAttribute('aria-label', 'Mock 文件格式错误，修复后才能保存')
    expect(screen.getByRole('button', { name: '取消' })).not.toBeDisabled()
    fireEvent.change(nameInput, { target: { value: 'cart-edited-more' } })

    // file fixed → server broadcasts mocksUpdated → status re-fetched
    state.invalid = false
    act(() => { window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: [rule] })) })
    await vi.waitFor(() => expect(screen.queryByTestId('mock-editor-file-invalid')).not.toBeInTheDocument())
    expect((screen.getByDisplayValue('cart-edited-more') as HTMLInputElement).value).toBe('cart-edited-more')
    expect(saveButton()).not.toBeDisabled()
    await act(async () => { fireEvent.click(saveButton()) })
    await vi.waitFor(() => expect(state.puts).toHaveLength(1))
    expect(state.puts[0]).toMatchObject({ name: 'cart-edited-more' })
  })

  it('file breaks while the editor is open (no save attempt): editor stays, save disabled', async () => {
    const state = stubServer()
    render(<Harness />)
    fireEvent.click(await screen.findByText('/cart/items'))
    fireEvent.change(await screen.findByDisplayValue('cart'), { target: { value: 'typed' } })
    state.invalid = true
    act(() => { window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: [] })) })
    await screen.findByTestId('mock-editor-file-invalid')
    expect(screen.getByDisplayValue('typed')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('rule deleted elsewhere while the file is valid: editor closes', async () => {
    stubServer()
    render(<Harness />)
    fireEvent.click(await screen.findByText('/cart/items'))
    await screen.findByDisplayValue('cart')
    act(() => { window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: [] })) })
    await vi.waitFor(() => expect(screen.getByText(/选择左侧规则/)).toBeInTheDocument())
  })
})

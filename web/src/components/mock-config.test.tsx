import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MockConfig, MOCK_OPEN_CREATE_EVENT } from './mock-config'
import type { MockRule } from '@/types'
import { MOCK_LIST_STORAGE_KEY } from '@/lib/mock-pane-split'

vi.mock('./mock-editor-panel', () => ({
  MockEditorPanel: ({ rule, initialData }: { rule?: MockRule; initialData?: Partial<MockRule> }) => (
    <div data-testid="mock-editor-stub">
      {rule ? `edit:${rule.id}` : `create:${initialData?.urlPattern ?? 'empty'}`}
    </div>
  ),
}))

const rules: MockRule[] = [
  {
    id: 1,
    name: 'cart',
    urlPattern: '/cart/items',
    method: 'GET',
    statusCode: 200,
    delay: 0,
    bodyType: 'inline',
    headers: {},
    body: '{}',
    enabled: true,
  },
]

function renderMock(extra: Partial<Parameters<typeof MockConfig>[0]> = {}) {
  return render(
    <div style={{ height: 600 }}>
      <MockConfig
        mockRules={rules}
        fetchMocks={vi.fn(async () => undefined)}
        createMock={vi.fn(async () => null)}
        updateMock={vi.fn(async () => true)}
        deleteMock={vi.fn(async () => true)}
        {...extra}
      />
    </div>,
  )
}

describe('MockConfig list|edit (P3 / #90)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders list and idle edit pane without Sheet', () => {
    renderMock()
    expect(screen.getByTestId('mock-config-layout')).toHaveAttribute('data-layout', 'list-edit')
    expect(screen.getByTestId('mock-config-list')).toBeInTheDocument()
    expect(screen.getByTestId('mock-config-edit')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-editor-stub')).not.toBeInTheDocument()
    expect(screen.getByText(/选择左侧规则/)).toBeInTheDocument()
  })

  it('opens editor when a row is clicked', () => {
    renderMock()
    fireEvent.click(screen.getByTestId('mock-config-row-1'))
    expect(screen.getByTestId('mock-editor-stub')).toHaveTextContent('edit:1')
  })

  it('opens create editor from toolbar', () => {
    renderMock()
    fireEvent.click(screen.getByTestId('mock-config-create'))
    expect(screen.getByTestId('mock-editor-stub')).toHaveTextContent('create:empty')
  })

  it('opens create editor from traffic one-click event with prefill', () => {
    renderMock()
    act(() => {
      window.dispatchEvent(
        new CustomEvent(MOCK_OPEN_CREATE_EVENT, {
          detail: { initialData: { urlPattern: '/from-traffic', method: 'POST' } },
        }),
      )
    })
    expect(screen.getByTestId('mock-editor-stub')).toHaveTextContent('create:/from-traffic')
  })

  it('uses a draggable list pane like the rules panel and remembers the width', () => {
    localStorage.removeItem(MOCK_LIST_STORAGE_KEY)
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    renderMock()
    const layout = screen.getByTestId('mock-config-layout')
    const list = screen.getByTestId('mock-config-list')
    expect(layout).toHaveAttribute('data-mock-list-width', '480')
    expect(list).toHaveStyle({ width: '480px', flex: '0 0 480px' })
    expect(screen.getByTestId('mock-panel-separator')).toBeInTheDocument()

    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1400, top: 0, height: 800, right: 1400, bottom: 800, x: 0, y: 0, toJSON: () => {} }),
    })

    fireEvent.mouseDown(screen.getByTestId('mock-panel-separator'))
    act(() => {
      fireEvent.mouseMove(document, { clientX: 560 })
      fireEvent.mouseUp(document)
    })

    expect(localStorage.getItem(MOCK_LIST_STORAGE_KEY)).toBe('560')
    expect(layout).toHaveAttribute('data-mock-list-width', '560')
    expect(list).toHaveStyle({ width: '560px' })
    localStorage.removeItem(MOCK_LIST_STORAGE_KEY)
  })
})

describe('MockConfig missing mocks file notice (#118)', () => {
  const missingPath = '/tmp/some/very/long/nested/directory/structure/for/meddle/fresh-mocks.json'

  function stubMocksFile(statuses: Array<Record<string, unknown>>) {
    let call = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/mocks-file') {
        const status = statuses[Math.min(call, statuses.length - 1)]
        call++
        return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the full path in the empty state when the file does not exist', async () => {
    stubMocksFile([{ path: missingPath, exists: false, custom: true }])
    renderMock({ mockRules: [] })
    const note = await screen.findByTestId('mock-config-file-missing')
    expect(note).toHaveTextContent('文件不存在')
    expect(note).toHaveTextContent('保存第一条规则时会创建')
    // path on its own line; textContent is the exact full path (screen readers / copy)
    const pathEl = screen.getByTestId('mock-config-file-missing-path')
    expect(pathEl.textContent).toBe(missingPath)
    expect(pathEl).toHaveClass('font-mono')
    // a <wbr> after every "/" so long paths break at segment boundaries
    expect(pathEl.querySelectorAll('wbr')).toHaveLength(missingPath.split('/').length - 1)
    // notice + regular empty text form one centered, max-360px muted block
    const block = note.parentElement!
    expect(block).toHaveClass('max-w-[360px]', 'mx-auto', 'text-center', 'text-muted-foreground')
    expect(block).toHaveTextContent(/暂无 Mock 规则/)
  })

  it('shows no notice when the file exists', async () => {
    const fetchMock = stubMocksFile([{ path: '/tmp/mocks.json', exists: true, custom: true }])
    renderMock({ mockRules: [] })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/mocks-file', { cache: 'no-store' }))
    expect(screen.queryByTestId('mock-config-file-missing')).not.toBeInTheDocument()
    expect(screen.getByText(/暂无 Mock 规则/)).toBeInTheDocument()
  })

  it('shows no notice when the default mocks file has not been created yet', async () => {
    const fetchMock = stubMocksFile([{ path: '/home/me/.meddle/mocks.json', exists: false, custom: false }])
    renderMock({ mockRules: [] })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/mocks-file', { cache: 'no-store' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('mock-config-file-missing')).not.toBeInTheDocument()
    expect(screen.getByText(/暂无 Mock 规则/)).toBeInTheDocument()
  })

  it('hides the notice after a server mocksUpdated broadcast reports the file now exists', async () => {
    stubMocksFile([{ path: missingPath, exists: false, custom: true }, { path: missingPath, exists: true, custom: true }])
    renderMock({ mockRules: [] })
    expect(await screen.findByTestId('mock-config-file-missing')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: [] }))
    })
    await vi.waitFor(() => expect(screen.queryByTestId('mock-config-file-missing')).not.toBeInTheDocument())
  })

  it('re-checks when the rule count changes (first save created the file)', async () => {
    const fetchMock = stubMocksFile([{ path: missingPath, exists: false, custom: true }, { path: missingPath, exists: true, custom: true }])
    const statusCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/mocks-file').length
    const renderWith = (mockRules: MockRule[]) => (
      <div style={{ height: 600 }}>
        <MockConfig
          mockRules={mockRules}
          fetchMocks={vi.fn(async () => undefined)}
          createMock={vi.fn(async () => null)}
          updateMock={vi.fn(async () => true)}
          deleteMock={vi.fn(async () => true)}
        />
      </div>
    )
    const view = render(renderWith([]))
    expect(await screen.findByTestId('mock-config-file-missing')).toBeInTheDocument()
    view.rerender(renderWith(rules))
    await vi.waitFor(() => expect(statusCalls()).toBe(2))
    // e.g. the rule is deleted again: the file exists now, so no notice
    view.rerender(renderWith([]))
    await vi.waitFor(() => expect(statusCalls()).toBe(3))
    await vi.waitFor(() => expect(screen.queryByTestId('mock-config-file-missing')).not.toBeInTheDocument())
  })

  describe('invalid mocks file (issue #120)', () => {
    const badPath = '/tmp/some/nested/dir/broken-mocks.json'
    const invalid = {
      path: badPath, exists: true, custom: true, valid: false,
      parseError: { line: 12, column: 5, message: 'Unexpected token }' },
    }

    it('shows 「文件格式错误」 with path + location instead of the empty text, and disables create', async () => {
      stubMocksFile([invalid])
      renderMock({ mockRules: [] })
      const block = await screen.findByTestId('mock-config-file-invalid')
      expect(block).toHaveTextContent('文件格式错误')
      expect(block.parentElement).toHaveClass('max-w-[360px]', 'mx-auto', 'text-center')
      expect(block.querySelector('.text-destructive')).toHaveTextContent('文件格式错误')
      const pathEl = screen.getByTestId('mock-config-file-invalid-path')
      expect(pathEl.textContent).toBe(badPath)
      expect(pathEl).toHaveClass('font-mono')
      expect(pathEl.querySelectorAll('wbr')).toHaveLength(badPath.split('/').length - 1)
      const loc = screen.getByTestId('mock-config-file-invalid-location')
      expect(loc).toHaveTextContent('第 12 行第 5 列：Unexpected token }')
      expect(loc).toHaveClass('font-mono', 'text-muted-foreground')
      expect(screen.queryByText(/暂无 Mock 规则/)).not.toBeInTheDocument()
      expect(screen.getByTestId('mock-config-create')).toBeDisabled()
      expect(screen.getByTestId('mock-config-create-wrapper')).toHaveAttribute('aria-label', 'Mock 文件格式错误，修复后才能新增')
    })

    it('blocks one-click create from traffic while invalid', async () => {
      stubMocksFile([invalid])
      renderMock({ mockRules: [] })
      await screen.findByTestId('mock-config-file-invalid')
      act(() => {
        window.dispatchEvent(new CustomEvent(MOCK_OPEN_CREATE_EVENT, { detail: { urlPattern: '/x' } }))
      })
      expect(screen.queryByTestId('mock-editor-stub')).not.toBeInTheDocument()
    })

    it('recovers after the server broadcasts the fixed file', async () => {
      stubMocksFile([invalid, { path: badPath, exists: true, custom: true, valid: true, parseError: null }])
      renderMock({ mockRules: [] })
      await screen.findByTestId('mock-config-file-invalid')
      act(() => {
        window.dispatchEvent(new CustomEvent('mocksUpdated', { detail: [] }))
      })
      await vi.waitFor(() => expect(screen.queryByTestId('mock-config-file-invalid')).not.toBeInTheDocument())
      expect(screen.getByTestId('mock-config-create')).not.toBeDisabled()
    })
  })
})

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MockConfig, MOCK_OPEN_CREATE_EVENT } from './mock-config'
import type { MockRule } from '@/types'

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
})

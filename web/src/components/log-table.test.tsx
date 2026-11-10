import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogTable, LOG_CARD_ROW_HEIGHT, scaledLogRowHeight } from './log-table'
import { installViewport } from '@/test/viewport'

const { scrollToOffsetMock, scrollToIndexMock, measureMock, useVirtualizerMock, zoomState } = vi.hoisted(() => {
  const zoomState = { zoom: 1 }
  const scrollToOffsetMock = vi.fn()
  const scrollToIndexMock = vi.fn()
  const measureMock = vi.fn()
  const useVirtualizerMock = vi.fn((opts: { estimateSize: () => number }) => ({
    getVirtualItems: () => [{ index: 0, key: 0, size: opts.estimateSize(), start: 0 }],
    getTotalSize: () => opts.estimateSize(),
    scrollToOffset: scrollToOffsetMock,
    scrollToIndex: scrollToIndexMock,
    measure: measureMock,
  }))
  return { scrollToOffsetMock, scrollToIndexMock, measureMock, useVirtualizerMock, zoomState }
})

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { estimateSize: () => number }) => useVirtualizerMock(opts),
}))

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    zoom: zoomState.zoom,
    setZoom: vi.fn(),
    theme: 'light',
    resolvedTheme: 'light',
    accentColor: 'auto',
    setTheme: vi.fn(),
    setAccentColor: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}))

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  zoomState.zoom = 1
  window.matchMedia = originalMatchMedia
  scrollToOffsetMock.mockClear()
  scrollToIndexMock.mockClear()
  measureMock.mockClear()
  useVirtualizerMock.mockClear()
})

describe('LogTable application source', () => {
  it('switches time order without requiring a sorted copy', () => {
    scrollToOffsetMock.mockClear()
    render(
      <LogTable
        records={[
          { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
          { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
        ]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('https://new.example.com')).toBeInTheDocument()
    expect(screen.queryByText('https://old.example.com')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /时间/ }))

    expect(screen.getByText('https://old.example.com')).toBeInTheDocument()
    expect(screen.queryByText('https://new.example.com')).not.toBeInTheDocument()
    expect(scrollToOffsetMock).toHaveBeenCalledTimes(1)
    expect(scrollToOffsetMock).toHaveBeenCalledWith(0)
  })

  it('does not reset scroll position during ordinary virtual-list rerenders', () => {
    scrollToOffsetMock.mockClear()
    const { rerender } = render(
      <LogTable
        records={[
          { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
          { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
        ]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    rerender(
      <LogTable
        records={[
          { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
          { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
        ]}
        selectedRecordId={2}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(scrollToOffsetMock).not.toHaveBeenCalled()
  })

  it('keeps the user position when live records arrive after scrolling away from the live edge', () => {
    scrollToOffsetMock.mockClear()
    const onSelect = vi.fn()
    const { rerender } = render(
      <LogTable
        records={[
          { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
          { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
        ]}
        selectedRecordId={null}
        onSelect={onSelect}
        autoScroll
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    viewport.scrollTop = 400
    fireEvent.scroll(viewport)

    act(() => {
      rerender(
        <LogTable
          records={[
            { id: 3, method: 'GET', source: 'https://latest.example.com', target: 'latest', time: '10:00:03' },
            { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
            { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
          ]}
          selectedRecordId={null}
          onSelect={onSelect}
          autoScroll
        />,
      )
    })

    expect(viewport.scrollTop).toBe(400)
    expect(scrollToOffsetMock).not.toHaveBeenCalled()
  })

  it('continues following live records while the user remains at the live edge', () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0)
        return 1
      })
    const records = [
      { id: 2, method: 'GET', source: 'https://new.example.com', target: 'new', time: '10:00:02' },
      { id: 1, method: 'GET', source: 'https://old.example.com', target: 'old', time: '10:00:01' },
    ]
    const { rerender } = render(
      <LogTable
        records={records}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    viewport.scrollTop = 20
    fireEvent.scroll(viewport)

    rerender(
      <LogTable
        records={[
          { id: 3, method: 'GET', source: 'https://latest.example.com', target: 'latest', time: '10:00:03' },
          ...records,
        ]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll
      />,
    )

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
    expect(viewport.scrollTop).toBe(0)
    requestAnimationFrameSpy.mockRestore()
  })

  it('renders a hit badge column for mock / rule rows', () => {
    render(
      <LogTable
        records={[
          {
            id: 1,
            method: 'GET',
            source: 'https://a.example/x',
            target: 'https://b.example/x',
            time: '10:00:00',
          },
          {
            id: 2,
            method: 'POST',
            source: 'https://a.example/y',
            target: 'https://a.example/y',
            time: '10:00:01',
            mock: true,
          },
        ]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('命中')).toBeInTheDocument()
    // virtualizer mock only renders first row
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-hit-kind', 'rule')
    expect(badge).toHaveTextContent('Rule')
  })

  it('renders muted pass hit badge when source equals target', () => {
    render(
      <LogTable
        records={[
          {
            id: 1,
            method: 'GET',
            source: 'https://cdn.example/a.js',
            target: 'https://cdn.example/a.js',
            time: '10:00:00',
          },
        ]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-hit-kind', 'pass')
    expect(badge).toHaveTextContent('—')
  })

  it('keeps row selection working with hit badges present', () => {
    const onSelect = vi.fn()
    render(
      <LogTable
        records={[
          {
            id: 7,
            method: 'PUT',
            source: 'https://api.example/cart',
            target: 'https://staging.example/cart',
            time: '10:00:00',
          },
        ]}
        selectedRecordId={null}
        onSelect={onSelect}
        autoScroll={false}
      />,
    )

    fireEvent.click(screen.getByText('https://api.example/cart'))
    expect(onSelect).toHaveBeenCalledWith(7)
  })

  it('shows the application name and process metadata', () => {
    render(
      <LogTable
        records={[{
          id: 1,
          method: 'GET',
          source: 'https://example.com',
          target: 'https://example.com',
          time: '10:00:00',
          clientType: 'local',
          clientName: '本机',
          applicationName: 'Google Chrome',
          applicationProcess: 'Google Chrome Helper',
          applicationPid: 2642,
          applicationBundleId: 'com.google.Chrome',
          applicationIdentitySource: 'local-process',
          applicationIdentityConfidence: 'high',
        }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('应用')).toBeInTheDocument()
    expect(screen.getByText('Google Chrome').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('Google Chrome Helper'),
    )
    expect(document.querySelector('[data-application-icon="chrome"]')).toBeInTheDocument()
    expect(screen.queryByText('推断')).not.toBeInTheDocument()
  })

  it('marks remote User-Agent identities as inferred', () => {
    render(
      <LogTable
        records={[{
          id: 2,
          method: 'GET',
          source: 'https://example.com',
          target: 'https://example.com',
          time: '10:00:01',
          clientType: 'remote',
          clientName: 'iPhone',
          applicationName: 'Safari',
          applicationIdentitySource: 'user-agent',
          applicationIdentityConfidence: 'medium',
        }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    expect(screen.getByText('Safari')).toBeInTheDocument()
    expect(screen.getByText('推断')).toBeInTheDocument()
    expect(screen.getByText('Safari').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('User-Agent 推断'),
    )
    expect(document.querySelector('[data-application-icon="safari"]')).toBeInTheDocument()
  })

  it('paints HTTP status badges with success, warning, and error variants', () => {
    const { rerender } = render(
      <LogTable
        records={[{ id: 1, method: 'GET', source: 'https://ok.example', target: 'ok', time: '10:00:01', statusCode: 200 }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )
    expect(screen.getByText('200')).toHaveAttribute('data-variant', 'success')

    rerender(
      <LogTable
        records={[{ id: 1, method: 'GET', source: 'https://go.example', target: 'go', time: '10:00:01', statusCode: 302 }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )
    expect(screen.getByText('302')).toHaveAttribute('data-variant', 'secondary')

    rerender(
      <LogTable
        records={[{ id: 1, method: 'GET', source: 'https://miss.example', target: 'miss', time: '10:00:01', statusCode: 404 }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )
    expect(screen.getByText('404')).toHaveAttribute('data-variant', 'warning')

    rerender(
      <LogTable
        records={[{ id: 1, method: 'DELETE', source: 'https://down.example', target: 'down', time: '10:00:01', statusCode: 500 }]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )
    expect(screen.getByText('500')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByText('DELETE')).toHaveAttribute('data-variant', 'destructive')
  })
})

const profileRecord = {
  id: 1,
  method: 'GET',
  statusCode: 200,
  source: 'http://api.example.com/user/profile',
  target: 'http://127.0.0.1:8930/user/profile',
  time: '5:46:42 PM',
  duration: 121,
  protocol: 'h1.1',
  clientType: 'local' as const,
  clientName: '本机',
  mock: true,
}

describe('LogTable narrow cards', () => {
  it('shows the source URL on a two-line row without the wide track', () => {
    installViewport(390)
    const onSelect = vi.fn()
    render(
      <LogTable
        records={[
          profileRecord,
          { id: 2, method: 'POST', source: 'http://api.example.com/other', target: 'other', time: '5:46:43 PM', statusCode: 201 },
        ]}
        selectedRecordId={null}
        onSelect={onSelect}
        autoScroll={false}
      />,
    )

    const row = screen.getByRole('row', { name: 'GET 200 http://api.example.com/user/profile' })
    expect(row).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('log-table')).toHaveAttribute('data-layout', 'cards')
    expect(screen.getByTestId('log-table-track').className).not.toContain('min-w-[calc(960/14*1rem)]')
    expect(screen.getByTestId('log-table-track').parentElement).toHaveClass('overflow-x-hidden')

    const url = screen.getByText('http://api.example.com/user/profile')
    expect(url).toHaveAttribute('title', 'http://api.example.com/user/profile')
    expect(url).toHaveClass('truncate')
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()

    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(1)

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(3)

    fireEvent.keyDown(row, { key: 'ArrowDown' })
    expect(scrollToIndexMock).toHaveBeenCalledWith(1, { align: 'auto' })
    expect(useVirtualizerMock.mock.calls.at(-1)?.[0].estimateSize()).toBe(LOG_CARD_ROW_HEIGHT)
  })

  it('keeps the card layout when the detail sheet is open on a narrow viewport', () => {
    installViewport(390)
    render(
      <LogTable
        records={[profileRecord]}
        selectedRecordId={1}
        onSelect={vi.fn()}
        autoScroll={false}
        detailOpen
      />,
    )

    expect(screen.getByTestId('log-table')).toHaveAttribute('data-layout', 'cards')
    const row = screen.getByRole('row', { name: /http:\/\/api\.example\.com\/user\/profile/ })
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('columnheader', { name: '协议' })).not.toBeInTheDocument()
  })
})

describe('LogTable columns while the detail pane is open', () => {
  it('hides secondary columns and keeps method, status, and the source URL', () => {
    installViewport(1440)
    const onSelect = vi.fn()
    render(
      <LogTable
        records={[profileRecord]}
        selectedRecordId={null}
        onSelect={onSelect}
        autoScroll={false}
        detailOpen
      />,
    )

    expect(screen.getByTestId('log-table')).toHaveAttribute('data-layout', 'compact')
    expect(screen.getByRole('columnheader', { name: '方法' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '状态' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '源地址' })).toBeInTheDocument()
    for (const name of ['来源', '应用', '目标地址', '协议', '耗时', '时间', '命中']) {
      expect(screen.queryByRole('columnheader', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /时间/ })).not.toBeInTheDocument()

    const row = screen.getByRole('row', { name: 'GET 200 http://api.example.com/user/profile' })
    const url = screen.getByText('http://api.example.com/user/profile')
    expect(url).toHaveAttribute('title', 'http://api.example.com/user/profile')
    expect(url).toHaveClass('min-w-0', 'truncate')
    expect(screen.getByTestId('log-table-track').className).not.toContain('min-w-[calc(960/14*1rem)]')
    expect(screen.queryByText('h1.1')).not.toBeInTheDocument()
    expect(screen.queryByText('121ms')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(1)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('keeps the full column set on a wide viewport when detail is closed', () => {
    installViewport(1440)
    render(
      <LogTable
        records={[profileRecord]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
        detailOpen={false}
      />,
    )

    expect(screen.getByTestId('log-table')).toHaveAttribute('data-layout', 'full')
    expect(screen.getByRole('columnheader', { name: '协议' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '耗时' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '命中' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '目标地址' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /时间/ })).toBeInTheDocument()
    expect(screen.getByTestId('log-table-track')).toHaveClass('min-w-[calc(960/14*1rem)]')
    expect(screen.getByText('http://api.example.com/user/profile')).toBeInTheDocument()
  })
})

describe('LogTable empty state at a narrow viewport (#166)', () => {
  it('keeps the empty copy in the visible pane, not in the 960px track', () => {
    render(
      <LogTable
        records={[]}
        selectedRecordId={null}
        onSelect={vi.fn()}
        autoScroll={false}
      />,
    )

    const empty = screen.getByTestId('log-table-empty')
    const title = screen.getByText('暂无请求记录')
    const description = screen.getByText('打开需要调试的页面后，请求会实时显示在这里。')
    expect(empty).toContainElement(title)
    expect(empty).toContainElement(description)
    expect(empty).toHaveClass('inset-x-0', 'top-7')
    expect(title.closest('[data-slot="empty-header"]')).toHaveClass('max-w-full')

    const track = screen.getByTestId('log-table-track')
    expect(track).toHaveClass('min-w-[calc(960/14*1rem)]')
    expect(track).not.toContainElement(empty)
  })
})

describe('LogTable zoom row height', () => {
  it('scales the virtualizer estimate and remeasures when zoom changes', () => {
    const props = {
      records: [{ id: 1, method: 'GET', source: 'https://a.example', target: 'a', time: '10:00:00' }],
      selectedRecordId: null,
      onSelect: vi.fn(),
      autoScroll: false,
    }

    const { rerender } = render(<LogTable {...props} />)
    expect(useVirtualizerMock.mock.calls.at(-1)?.[0].estimateSize()).toBe(22)
    expect(measureMock).toHaveBeenCalled()

    measureMock.mockClear()
    zoomState.zoom = 1.5
    rerender(<LogTable {...props} />)

    expect(useVirtualizerMock.mock.calls.at(-1)?.[0].estimateSize()).toBe(33)
    expect(measureMock).toHaveBeenCalled()
  })

  it('keeps the 100% row height constant at 22', () => {
    expect(scaledLogRowHeight(1)).toBe(22)
    expect(scaledLogRowHeight(0.75)).toBe(16.5)
    expect(scaledLogRowHeight(1.5)).toBe(33)
  })
})

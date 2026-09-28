import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogTable } from './log-table'

const { scrollToOffsetMock } = vi.hoisted(() => ({
  scrollToOffsetMock: vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, key: 0, size: 22, start: 0 }],
    getTotalSize: () => 22,
    scrollToOffset: scrollToOffsetMock,
  }),
}))

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
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogFilter } from './log-filter'

function renderFilter() {
  return render(
    <LogFilter
      filterText=""
      setFilterText={vi.fn()}
      resourceTypeFilter="all"
      setResourceTypeFilter={vi.fn()}
      clientSourceFilter="all"
      setClientSourceFilter={vi.fn()}
      totalCount={1}
      filteredCount={1}
      onClear={vi.fn()}
      recording
      onToggleRecording={vi.fn()}
    />,
  )
}

function setOverflow(el: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft })
}

describe('LogFilter chip row', () => {
  it('keeps every resource chip in one scrollable row and fades the clipped edge', () => {
    renderFilter()

    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Wasm' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '流量来源' })).toBeInTheDocument()

    const row = screen.getByTestId('log-filter-source-type-row')
    expect(row).toHaveClass('flex-nowrap', 'overflow-x-auto')
    expect(row).toContainElement(screen.getByRole('radio', { name: 'Other' }))
    expect(screen.queryByTestId('log-filter-fade-right')).not.toBeInTheDocument()

    setOverflow(row, 787, 750)
    fireEvent.scroll(row)

    const fade = screen.getByTestId('log-filter-fade-right')
    expect(fade).toHaveClass('from-card', 'pointer-events-none')
    expect(screen.queryByTestId('log-filter-fade-left')).not.toBeInTheDocument()

    setOverflow(row, 787, 750, 20)
    fireEvent.scroll(row)
    expect(screen.getByTestId('log-filter-fade-left')).toBeInTheDocument()
    expect(screen.getByTestId('log-filter-fade-right')).toBeInTheDocument()
  })
})

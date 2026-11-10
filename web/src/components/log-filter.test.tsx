import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogFilter, resolveChipFade } from './log-filter'

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
    expect(fade).toHaveStyle({ width: '24px' })
    expect(screen.queryByTestId('log-filter-fade-left')).not.toBeInTheDocument()

    setOverflow(row, 787, 750, 20)
    fireEvent.scroll(row)
    expect(screen.getByTestId('log-filter-fade-left')).toBeInTheDocument()
    expect(screen.getByTestId('log-filter-fade-right')).toBeInTheDocument()
  })

  it('covers a chip that would be half-cut at the resting scroll position', () => {
    const fade = resolveChipFade({
      scrollLeft: 0,
      clientWidth: 160,
      scrollWidth: 400,
      chips: [
        { left: 0, right: 80 },
        { left: 86, right: 140 },
        { left: 146, right: 186 },
      ],
    })

    expect(fade.rightInset).toBeGreaterThanOrEqual(160 - 146)
    expect(160 - fade.rightInset).toBeGreaterThanOrEqual(140)
    expect(fade.rightFade).toBe(6)
    expect(fade.leftInset).toBe(0)
  })

  it('keeps a visible fade when the clip falls in the gap after a whole chip', () => {
    const fade = resolveChipFade({
      scrollLeft: 0,
      clientWidth: 308,
      scrollWidth: 748,
      chips: [
        { left: 260, right: 304 },
        { left: 307, right: 341 },
      ],
    })

    expect(fade.rightInset).toBeGreaterThanOrEqual(12)
    expect(308 - fade.rightInset).toBeGreaterThanOrEqual(260 + 22)
    expect(fade.rightInset).toBeLessThanOrEqual(308 - 304 + 12)

    renderFilter()
    const row = screen.getByTestId('log-filter-source-type-row')
    const doc = screen.getByRole('radio', { name: 'Doc' })
    const fetchChip = screen.getByRole('radio', { name: 'Fetch/XHR' })
    stubBox(row, { left: 0, width: 160, scrollWidth: 400, clientWidth: 160, scrollLeft: 0 })
    stubBox(fetchChip, { left: 86, width: 54 })
    stubBox(doc, { left: 146, width: 40 })
    for (const chip of row.querySelectorAll<HTMLElement>('[data-log-filter-chip]')) {
      if (chip !== doc && chip !== fetchChip) stubBox(chip, { left: 0, width: 0 })
    }
    fireEvent.scroll(row)

    const overlay = screen.getByTestId('log-filter-fade-right')
    expect(overlay).toHaveStyle({ width: '20px' })
    expect(overlay.style.background).toContain('var(--card)')
    expect(screen.getByRole('radio', { name: 'Doc' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Other' })).toBeInTheDocument()
  })
})

function stubBox(
  el: HTMLElement,
  box: { left: number; width: number; scrollWidth?: number; clientWidth?: number; scrollLeft?: number },
) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: box.left,
      y: 0,
      left: box.left,
      right: box.left + box.width,
      top: 0,
      bottom: 20,
      width: box.width,
      height: 20,
      toJSON() { return {} },
    }),
  })
  if (box.scrollWidth != null) Object.defineProperty(el, 'scrollWidth', { configurable: true, value: box.scrollWidth })
  if (box.clientWidth != null) Object.defineProperty(el, 'clientWidth', { configurable: true, value: box.clientWidth })
  if (box.scrollLeft != null) Object.defineProperty(el, 'scrollLeft', { configurable: true, value: box.scrollLeft })
}

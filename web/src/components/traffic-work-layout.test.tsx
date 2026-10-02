import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrafficWorkLayout } from './traffic-work-layout'
import { TRAFFIC_NARROW_MAX_WIDTH_PX, TRAFFIC_SPLIT_STORAGE_KEY } from '@/lib/traffic-split'

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches,
    media: '',
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    mql.media = query
    return mql
  }) as unknown as typeof window.matchMedia
  return {
    setMatches(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe('TrafficWorkLayout (P2 / #89)', () => {
  beforeEach(() => {
    localStorage.removeItem(TRAFFIC_SPLIT_STORAGE_KEY)
  })

  afterEach(() => {
    localStorage.removeItem(TRAFFIC_SPLIT_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('renders wide split with master + detail and a resizable handle', () => {
    mockMatchMedia(false)
    render(
      <TrafficWorkLayout
        master={<div>master-pane</div>}
        detail={<div>detail-pane</div>}
      />,
    )

    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-layout', 'split')
    expect(screen.getByTestId('traffic-master')).toHaveTextContent('master-pane')
    expect(screen.getByTestId('traffic-detail')).toHaveTextContent('detail-pane')
    expect(screen.getByTestId('traffic-split-handle')).toBeInTheDocument()
    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-split-pct', '60')
  })

  it('fresh profile uses ~60% left pane; stored pct overrides (#95)', () => {
    mockMatchMedia(false)
    const { unmount } = render(
      <TrafficWorkLayout master={<div>m</div>} detail={<div>d</div>} />,
    )
    const master = screen.getByTestId('traffic-master')
    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-split-pct', '60')
    expect(master).toHaveStyle({ width: '60%', flex: '0 0 60%' })
    unmount()

    localStorage.setItem(TRAFFIC_SPLIT_STORAGE_KEY, '48')
    render(<TrafficWorkLayout master={<div>m</div>} detail={<div>d</div>} />)
    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-split-pct', '48')
    expect(screen.getByTestId('traffic-master')).toHaveStyle({ width: '48%', flex: '0 0 48%' })
  })

  it('persists drag width to localStorage on mouseup', () => {
    mockMatchMedia(false)
    render(
      <div style={{ width: 1000 }}>
        <TrafficWorkLayout master={<div>m</div>} detail={<div>d</div>} />
      </div>,
    )

    const layout = screen.getByTestId('traffic-work-layout')
    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1000, top: 0, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => {} }),
    })

    const handle = screen.getByTestId('traffic-split-handle')
    fireEvent.mouseDown(handle)
    act(() => {
      fireEvent.mouseMove(document, { clientX: 450 })
      fireEvent.mouseUp(document)
    })

    expect(localStorage.getItem(TRAFFIC_SPLIT_STORAGE_KEY)).toBe('45')
    expect(layout).toHaveAttribute('data-split-pct', '45')
  })

  it(`collapses to narrow drawer host at ≤${TRAFFIC_NARROW_MAX_WIDTH_PX}px`, () => {
    mockMatchMedia(true)
    render(
      <TrafficWorkLayout
        master={<div>master-only</div>}
        detail={<div>should-hide</div>}
        drawer={<div data-testid="narrow-drawer">drawer</div>}
      />,
    )

    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-layout', 'narrow')
    expect(screen.getByTestId('traffic-master')).toHaveTextContent('master-only')
    expect(screen.queryByTestId('traffic-detail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('traffic-split-handle')).not.toBeInTheDocument()
    expect(screen.getByTestId('narrow-drawer')).toBeInTheDocument()
  })

  it('hides detail and split handle when detailOpen is false (#102)', () => {
    mockMatchMedia(false)
    render(
      <TrafficWorkLayout
        detailOpen={false}
        master={<div>master-full</div>}
        detail={<div>hidden-detail</div>}
      />,
    )

    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-layout', 'master-only')
    expect(screen.getByTestId('traffic-work-layout')).toHaveAttribute('data-detail-open', 'false')
    expect(screen.getByTestId('traffic-master')).toHaveTextContent('master-full')
    expect(screen.queryByTestId('traffic-detail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('traffic-split-handle')).not.toBeInTheDocument()
  })
})

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SHELL_NAV_COLLAPSED_KEY, ShellNav } from './app-header'
import { SHELL_NAV } from '@/lib/shell-mode'
import { installViewport } from '@/test/viewport'

vi.mock('./session-switcher', () => ({ SessionSwitcher: () => null }))
vi.mock('./ai-settings', () => ({ AIConfigBadge: () => null }))

const realMatchMedia = window.matchMedia

function renderNav(props: { mockEnabledCount?: number } = {}) {
  const onTabChange = vi.fn()
  const result = render(
    <MemoryRouter>
      <div data-testid="page-content">page</div>
      <ShellNav activeTab="logs" onTabChange={onTabChange} {...props} />
    </MemoryRouter>,
  )
  return { ...result, onTabChange }
}

const rail = () => screen.getByTestId('app-shell-nav-rail')
const toggle = () => screen.getByTestId('shell-nav-collapse')

describe('ShellNav narrow viewport (#109)', () => {
  beforeEach(() => {
    localStorage.removeItem(SHELL_NAV_COLLAPSED_KEY)
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
    localStorage.removeItem(SHELL_NAV_COLLAPSED_KEY)
  })

  it('auto-collapses below 1024px and restores the manual choice at >= 1024px without writing it', () => {
    localStorage.setItem(SHELL_NAV_COLLAPSED_KEY, '0')
    const viewport = installViewport(1280)
    renderNav()
    expect(rail()).toHaveAttribute('data-collapsed', 'false')
    expect(rail()).toHaveAttribute('data-narrow', 'false')

    act(() => viewport.setWidth(900))
    expect(rail()).toHaveAttribute('data-collapsed', 'true')
    expect(rail()).toHaveAttribute('data-narrow', 'true')
    expect(rail()).toHaveClass('w-14')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('0')

    act(() => viewport.setWidth(1023))
    expect(rail()).toHaveAttribute('data-collapsed', 'true')

    act(() => viewport.setWidth(1024))
    expect(rail()).toHaveAttribute('data-collapsed', 'false')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('0')
  })

  it('keeps a manual collapse across a narrow round trip, and narrow expand never writes the preference', () => {
    const viewport = installViewport(1280)
    renderNav()
    fireEvent.click(toggle())
    expect(rail()).toHaveAttribute('data-collapsed', 'true')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('1')

    act(() => viewport.setWidth(800))
    fireEvent.click(toggle())
    expect(rail()).toHaveAttribute('data-overlay', 'true')
    expect(rail()).toHaveAttribute('data-collapsed', 'false')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('1')

    act(() => viewport.setWidth(1280))
    expect(rail()).toHaveAttribute('data-overlay', 'false')
    expect(rail()).toHaveAttribute('data-collapsed', 'true')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('1')
  })

  it('a fresh profile on a narrow window starts collapsed and stores nothing', () => {
    installViewport(700)
    renderNav()
    expect(rail()).toHaveAttribute('data-collapsed', 'true')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBeNull()
  })

  it('narrow manual expand overlays the page and closes on Esc', () => {
    installViewport(900)
    renderNav()
    fireEvent.click(toggle())
    expect(rail()).toHaveAttribute('data-overlay', 'true')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    // Overlay, not push: the rail keeps its 56px slot and the panel floats above content.
    expect(rail()).toHaveClass('w-14')
    expect(screen.getByTestId('app-shell-nav-panel')).toHaveClass('absolute', 'z-30', 'bg-background')
    expect(screen.getByTestId('shell-nav-config')).toHaveTextContent('路由规则')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(rail()).toHaveAttribute('data-overlay', 'false')
    expect(rail()).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByTestId('app-shell-nav-panel')).not.toHaveClass('absolute')
    expect(toggle()).toHaveFocus()
  })

  it('narrow overlay closes on outside click but not on clicks inside it', () => {
    installViewport(900)
    const { onTabChange } = renderNav()
    fireEvent.click(toggle())
    fireEvent.pointerDown(screen.getByTestId('app-shell-nav'))
    expect(rail()).toHaveAttribute('data-overlay', 'true')

    fireEvent.pointerDown(screen.getByTestId('page-content'))
    expect(rail()).toHaveAttribute('data-overlay', 'false')

    fireEvent.click(toggle())
    fireEvent.mouseDown(screen.getByTestId('shell-nav-mock'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('mock')
    expect(rail()).toHaveAttribute('data-overlay', 'false')
  })

  it('shows a tooltip with the page name on every collapsed icon', async () => {
    installViewport(900)
    renderNav()
    for (const item of SHELL_NAV) {
      const trigger = screen.getByTestId(`shell-nav-${item.tab}`)
      expect(trigger).not.toHaveAttribute('title')
      act(() => trigger.focus())
      const tooltip = await screen.findByTestId(`shell-nav-tooltip-${item.tab}`)
      expect(tooltip).toHaveTextContent(item.label)
      expect(within(tooltip).getByRole('tooltip')).toHaveTextContent(item.label)
      act(() => trigger.blur())
    }
  })

  it('keeps the active tab state when wrapped in a tooltip', () => {
    installViewport(900)
    renderNav()
    expect(screen.getByTestId('shell-nav-logs')).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('shell-nav-config')).toHaveAttribute('data-state', 'inactive')
  })

  it('does not show tooltips while expanded', () => {
    installViewport(1280)
    renderNav()
    const trigger = screen.getByTestId('shell-nav-config')
    act(() => trigger.focus())
    expect(screen.queryByTestId('shell-nav-tooltip-config')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('title')
  })

  it('pins the collapsed mock badge to the icon button top-right corner', () => {
    installViewport(900)
    renderNav({ mockEnabledCount: 12 })
    const badge = screen.getByTestId('shell-nav-mock-badge')
    const button = screen.getByTestId('shell-nav-mock')
    // Direct child of the (relative) icon button, not of the glyph.
    expect(badge.parentElement).toBe(button)
    expect(button).toHaveClass('relative')
    expect(badge).toHaveClass('absolute', '-top-1', '-right-1', 'h-[16px]', 'min-w-[16px]', 'text-[10px]')
    expect(badge).not.toContainElement(button.querySelector('svg'))
    expect(badge).toHaveTextContent('12')
    // Stays inside the rail; the rail clips horizontally so it cannot spill onto content.
    expect(screen.getByTestId('app-shell-nav')).toHaveClass('w-14', 'overflow-x-hidden', 'gap-2.5')
  })

  it('uses the expanded inline badge when the rail is open', () => {
    installViewport(1280)
    renderNav({ mockEnabledCount: 3 })
    const badge = screen.getByTestId('shell-nav-mock-badge')
    expect(badge).not.toHaveClass('absolute')
    expect(badge).toHaveClass('h-5')
  })

  it('narrow overlay is a shadowed layer with no scrim', () => {
    installViewport(900)
    renderNav()
    fireEvent.click(toggle())
    expect(screen.getByTestId('app-shell-nav-panel')).toHaveClass('absolute', 'z-30', 'shadow-lg')
    expect(screen.queryByTestId('app-shell-nav-scrim')).not.toBeInTheDocument()
  })

  it('insets the expanded collapse toggle like the nav items instead of filling the row', () => {
    installViewport(900)
    renderNav()
    fireEvent.click(toggle())
    expect(toggle()).toHaveClass('mx-2.5', 'w-auto', 'rounded-md')
    expect(toggle()).not.toHaveClass('w-full')
  })
})

import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppHeader, SHELL_NAV_COLLAPSED_KEY, ShellNav } from './app-header'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./session-switcher', () => ({
  SessionSwitcher: () => <div data-testid="session-switcher-stub" />,
}))

vi.mock('./ai-settings', () => ({
  AIConfigBadge: () => <div data-testid="ai-badge-stub" />,
}))

vi.mock('./theme-provider', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
    accentColor: 'auto',
    setAccentColor: vi.fn(),
    setZoom: vi.fn(),
  }),
}))

function renderNav(props: Partial<ComponentProps<typeof ShellNav>> = {}) {
  const onTabChange = vi.fn()
  const result = render(
    <MemoryRouter>
      <ShellNav activeTab="logs" onTabChange={onTabChange} {...props} />
    </MemoryRouter>,
  )
  return { ...result, onTabChange }
}

describe('AppHeader', () => {
  it('places an input-style command trigger on the left of the utilities', () => {
    const onCommandClick = vi.fn()
    render(
      <MemoryRouter>
        <AppHeader onCommandClick={onCommandClick} />
      </MemoryRouter>,
    )
    const command = screen.getByTestId('shell-command')
    const utilities = screen.getByTestId('app-shell-utilities')
    expect(command.className).toContain('w-72')
    expect(command.className).toContain('border-input')
    expect(command).toHaveTextContent('搜索操作…')
    expect(command.compareDocumentPosition(utilities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(utilities).not.toContainElement(command)
    fireEvent.click(command)
    expect(onCommandClick).toHaveBeenCalledOnce()
  })
})

describe('ShellNav (07-shell)', () => {
  beforeEach(() => {
    localStorage.removeItem(SHELL_NAV_COLLAPSED_KEY)
  })

  it('renders a vertical primary nav with roomier items', () => {
    renderNav()
    const nav = screen.getByTestId('app-shell-nav')
    expect(nav.closest('[data-orientation]')).toHaveAttribute('data-orientation', 'vertical')
    expect(nav.className).toContain('!h-full')
    expect(nav.className).toContain('bg-transparent')
    expect(nav.className).not.toContain('bg-muted')
    expect(nav.className).toContain('gap-2.5')
    expect(nav.className).toContain('p-2.5')
    const order = Array.from(nav.querySelectorAll('[data-testid^="shell-nav-"]')).map((el) => el.getAttribute('data-testid'))
    expect(order.at(-1)).toBe('shell-nav-settings')
    expect(order.indexOf('shell-nav-settings') - order.indexOf('shell-nav-mobile')).toBe(1)
    const toggle = screen.getByTestId('shell-nav-collapse')
    expect(nav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.className).not.toContain('absolute')
    expect(toggle).not.toHaveTextContent('收起')
    expect(screen.getByTestId('shell-nav-logs').className).toContain('px-3.5')
    expect(screen.getByTestId('shell-nav-logs').className).toContain('py-3')
    expect(screen.getByTestId('shell-nav-logs')).toHaveTextContent('流量')
    expect(screen.getByTestId('shell-nav-config')).toHaveTextContent('路由规则')
    expect(screen.getByTestId('shell-nav-mock')).toHaveTextContent('Mock')
    expect(screen.getByTestId('shell-nav-plugins')).toHaveTextContent('扩展插件')
    expect(screen.getByTestId('shell-nav-health')).toHaveTextContent('健康')
    expect(screen.getByTestId('shell-nav-mobile')).toHaveTextContent('手机代理')
    expect(screen.getByTestId('shell-nav-settings')).toHaveTextContent('设置')
  })

  it('marks work vs config nav modes and active page', () => {
    renderNav({ activeTab: 'config' })
    expect(screen.getByTestId('shell-nav-logs')).toHaveAttribute('data-shell-nav-mode', 'work')
    expect(screen.getByTestId('shell-nav-config')).toHaveAttribute('data-shell-nav-mode', 'config')
    expect(screen.getByTestId('shell-nav-config')).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('shell-nav-config')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('shell-nav-logs')).toHaveAttribute('data-state', 'inactive')
  })

  it('switches tab with one click (work ↔ config)', () => {
    const onTabChange = vi.fn()
    const props = {
      onTabChange,
    }
    const { rerender } = render(
      <MemoryRouter>
        <ShellNav activeTab="logs" {...props} />
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByTestId('shell-nav-config'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('config')

    rerender(
      <MemoryRouter>
        <ShellNav activeTab="config" {...props} />
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByTestId('shell-nav-logs'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('logs')

    rerender(
      <MemoryRouter>
        <ShellNav activeTab="logs" {...props} />
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByTestId('shell-nav-mobile'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('mobile')
    fireEvent.mouseDown(screen.getByTestId('shell-nav-settings'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('settings')
  })

  it('highlights settings and mobile when those pages are open', () => {
    const { rerender, onTabChange } = renderNav({ activeTab: 'mobile' })
    expect(screen.getByTestId('shell-nav-mobile')).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('shell-nav-mobile')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('shell-nav-logs')).toHaveAttribute('data-state', 'inactive')

    rerender(
      <MemoryRouter>
        <ShellNav activeTab="settings" onTabChange={onTabChange} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('shell-nav-settings')).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('shell-nav-mobile')).toHaveAttribute('data-state', 'inactive')
  })

  it('shows mock enabled count badge when > 0', () => {
    renderNav({ mockEnabledCount: 3 })
    expect(screen.getByTestId('shell-nav-mock')).toHaveTextContent('3')
  })

  it('collapses to icons, persists, and expands again', () => {
    const { unmount, onTabChange } = renderNav()
    const toggle = screen.getByTestId('shell-nav-collapse')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('app-shell-nav-rail')).toHaveAttribute('data-collapsed', 'false')

    fireEvent.click(toggle)
    expect(screen.getByTestId('app-shell-nav-rail')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByTestId('shell-nav-collapse')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('shell-nav-collapse')).toHaveAttribute('aria-label', '展开菜单')
    expect(screen.getByTestId('shell-nav-logs').querySelector('[data-slot="shell-nav-label"]')).toHaveClass('sr-only')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('1')

    fireEvent.mouseDown(screen.getByTestId('shell-nav-health'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('health')

    fireEvent.click(screen.getByTestId('shell-nav-collapse'))
    expect(screen.getByTestId('app-shell-nav-rail')).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('shell-nav-logs').querySelector('[data-slot="shell-nav-label"]')).not.toHaveClass('sr-only')
    expect(localStorage.getItem(SHELL_NAV_COLLAPSED_KEY)).toBe('0')
    unmount()

    localStorage.setItem(SHELL_NAV_COLLAPSED_KEY, '1')
    renderNav()
    expect(screen.getByTestId('app-shell-nav-rail')).toHaveAttribute('data-collapsed', 'true')
  })
})

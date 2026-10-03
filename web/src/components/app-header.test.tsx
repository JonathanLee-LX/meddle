import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppHeader } from './app-header'
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

function renderHeader(props: Partial<ComponentProps<typeof AppHeader>> = {}) {
  const onTabChange = vi.fn()
  const result = render(
    <MemoryRouter>
      <AppHeader
        activeTab="logs"
        onTabChange={onTabChange}
        onSettingsClick={vi.fn()}
        onCommandClick={vi.fn()}
        onMobileProxyClick={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
  return { ...result, onTabChange }
}

describe('AppHeader shell nav (07-shell)', () => {
  it('renders top-bar primary nav with wireframe labels', () => {
    renderHeader()
    expect(screen.getByTestId('app-shell-nav')).toBeInTheDocument()
    expect(screen.getByTestId('shell-nav-logs')).toHaveTextContent('流量')
    expect(screen.getByTestId('shell-nav-config')).toHaveTextContent('路由规则')
    expect(screen.getByTestId('shell-nav-mock')).toHaveTextContent('Mock')
    expect(screen.getByTestId('shell-nav-plugins')).toHaveTextContent('扩展插件')
    expect(screen.getByTestId('shell-nav-health')).toHaveTextContent('健康')
  })

  it('marks work vs config nav modes and active page', () => {
    renderHeader({ activeTab: 'config' })
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
      onSettingsClick: vi.fn(),
      onCommandClick: vi.fn(),
      onMobileProxyClick: vi.fn(),
    }
    const { rerender } = render(
      <MemoryRouter>
        <AppHeader activeTab="logs" {...props} />
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByTestId('shell-nav-config'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('config')

    rerender(
      <MemoryRouter>
        <AppHeader activeTab="config" {...props} />
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByTestId('shell-nav-logs'), { button: 0, ctrlKey: false })
    expect(onTabChange).toHaveBeenCalledWith('logs')
  })

  it('shows mock enabled count badge when > 0', () => {
    renderHeader({ mockEnabledCount: 3 })
    expect(screen.getByTestId('shell-nav-mock')).toHaveTextContent('3')
  })
})

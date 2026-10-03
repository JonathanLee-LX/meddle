import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveButton } from './save-button'

function mockPlatform(platform: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true })
}

describe('SaveButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows only the macOS shortcut on Apple platforms', () => {
    mockPlatform('MacIntel')
    render(<SaveButton>保存</SaveButton>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+S')
    const hint = button.querySelector('[data-slot="save-shortcut"]')
    expect(hint).toHaveTextContent('⌘+S')
    expect(hint).not.toHaveTextContent('Ctrl')
  })

  it('shows only the Control shortcut on other platforms', () => {
    mockPlatform('Win32')
    render(<SaveButton>保存</SaveButton>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+S')
    const hint = button.querySelector('[data-slot="save-shortcut"]')
    expect(hint).toHaveTextContent('Ctrl+S')
    expect(hint).not.toHaveTextContent('⌘')
  })
})

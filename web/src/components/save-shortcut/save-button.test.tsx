import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SaveButton } from './save-button'

describe('SaveButton', () => {
  it('shows the platform save shortcut without changing the accessible name', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    render(<SaveButton>保存</SaveButton>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+S Control+S')
    expect(button.querySelector('[data-slot="save-shortcut"]')).toHaveTextContent('⌘S')
  })
})

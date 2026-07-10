import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SaveButton } from './save-button'

describe('SaveButton', () => {
  it('shows both save shortcuts without changing the accessible name', () => {
    render(<SaveButton>保存</SaveButton>)

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+S Control+S')
    expect(button.querySelector('[data-slot="save-shortcut"]')).toHaveTextContent('⌘+S / Ctrl+S')
  })
})

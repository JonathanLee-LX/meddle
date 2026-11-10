import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from './icon-button'

describe('IconButton', () => {
  it('names the button and shows that name on hover', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <IconButton label="重放" onClick={onClick}>
        <span data-testid="glyph" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: '重放' })
    expect(button).not.toHaveTextContent('重放')
    expect(button).toHaveAttribute('aria-label', '重放')

    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('重放')
    expect(button).not.toHaveAttribute('aria-describedby')

    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows a separate tooltip without replacing the accessible name', async () => {
    render(
      <IconButton label="当前主题: light，点击切换" tooltip="切换主题" tooltipSide="bottom">
        <span />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: '当前主题: light，点击切换' })
    act(() => button.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('切换主题')
    expect(button).toHaveAccessibleDescription('切换主题')
  })
})

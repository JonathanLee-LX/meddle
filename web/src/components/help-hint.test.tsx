import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HelpHint } from './help-hint'

const HELP = '统一按钮、状态、选中项和焦点样式。自动模式会根据明暗主题选择合适的颜色。'

function renderHint() {
  render(<HelpHint label="强调色说明">{HELP}</HelpHint>)
  return screen.getByRole('button', { name: '强调色说明' })
}

describe('HelpHint', () => {
  it('keeps the explanation hidden until hover', async () => {
    const user = userEvent.setup()
    const hint = renderHint()

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByText(HELP)).not.toBeInTheDocument()

    await user.hover(hint)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(HELP)
    expect(hint).toHaveAttribute('aria-expanded', 'true')
    expect(hint).toHaveAccessibleDescription(HELP)
    expect(hint.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('shows the explanation on focus and closes it with Escape', async () => {
    const user = userEvent.setup()
    const hint = renderHint()

    act(() => hint.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(HELP)
    expect(hint).toHaveAccessibleDescription(HELP)

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
    expect(hint).toHaveAttribute('aria-expanded', 'false')
    expect(hint).not.toHaveAttribute('aria-describedby')
  })

  it('toggles the explanation on a touch tap', async () => {
    const hint = renderHint()

    fireEvent.pointerDown(hint, { pointerType: 'touch' })
    fireEvent.click(hint)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(HELP)

    fireEvent.pointerDown(hint, { pointerType: 'touch' })
    fireEvent.click(hint)

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  it('uses a rem hit target and the shared tooltip colors', () => {
    const hint = renderHint()
    expect(hint.className).toContain('size-6')
    expect(hint.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

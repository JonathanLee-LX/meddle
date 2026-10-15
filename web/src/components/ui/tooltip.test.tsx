import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

function renderTip(triggerProps: Partial<ComponentProps<typeof TooltipTrigger>> = {}) {
  render(
    <Tooltip>
      <TooltipTrigger aria-label="删除规则" {...triggerProps}>
        x
      </TooltipTrigger>
      <TooltipContent>删除后不可恢复</TooltipContent>
    </Tooltip>,
  )
  const trigger = screen.getByRole('button', { name: '删除规则' })
  act(() => trigger.focus())
  return trigger
}

describe('TooltipTrigger describe', () => {
  it('describes the trigger with the open tooltip by default', async () => {
    const trigger = renderTip()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('删除后不可恢复')
    expect(trigger).toHaveAccessibleDescription('删除后不可恢复')
  })

  it('drops only the tooltip description when describe={false}', async () => {
    const trigger = renderTip({ describe: false })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('删除后不可恢复')
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(trigger).toHaveAccessibleDescription('')
  })

  it('keeps a caller-provided aria-describedby when describe={false}', async () => {
    render(<p id="hint">提示</p>)
    const trigger = renderTip({ describe: false, 'aria-describedby': 'hint' })
    await screen.findByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby', 'hint')
    expect(trigger).toHaveAccessibleDescription('提示')
  })
})

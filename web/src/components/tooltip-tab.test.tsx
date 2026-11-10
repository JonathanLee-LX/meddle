import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsList } from '@/components/ui/tabs'
import { TooltipTab } from './tooltip-tab'

function renderTabs(showTooltip = true) {
  render(
    <Tabs defaultValue="preferences">
      <TabsList aria-label="设置分类">
        <TooltipTab value="preferences" label="偏好设置" showTooltip={showTooltip}>
          <span className="hidden">偏好设置</span>
        </TooltipTab>
        <TooltipTab value="config" label="配置文件" showTooltip={showTooltip}>
          <span>配置文件</span>
        </TooltipTab>
      </TabsList>
    </Tabs>,
  )
}

describe('TooltipTab', () => {
  it('names the tab and shows that name on hover', async () => {
    const user = userEvent.setup()
    renderTabs()

    const tab = screen.getByRole('tab', { name: '偏好设置' })
    expect(tab).toHaveAttribute('aria-label', '偏好设置')

    await user.hover(tab)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('偏好设置')
    expect(tab).not.toHaveAttribute('aria-describedby')
  })

  it('stays quiet when the label is already visible', async () => {
    const user = userEvent.setup()
    renderTabs(false)

    const tab = screen.getByRole('tab', { name: '配置文件' })
    await user.hover(tab)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

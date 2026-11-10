import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPaneActionsProvider } from './editor-pane-actions'
import { MockEditorPanel } from './mock-editor-panel'

vi.mock('./monaco-editor', () => ({
  MonacoEditor: () => <div data-testid="mock-body-editor" />,
}))

describe('MockEditorPanel actions', () => {
  it('places save in the pane title bar', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host}>
        <MockEditorPanel
          createMock={vi.fn(async () => null)}
          updateMock={vi.fn(async () => true)}
          initialData={{ urlPattern: '/cart' }}
        />
      </EditorPaneActionsProvider>,
    )

    // The save button's textContent also holds the hidden sizing label (#140), so assert the accessible name.
    expect(within(host).getByRole('button', { name: '保存' })).toHaveAccessibleName('保存')
    expect(screen.getByRole('separator', { name: '调整响应内容编辑器高度' })).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    host.remove()
  })

  it('refuses to save an invalid regex URL pattern', async () => {
    const user = userEvent.setup()
    const createMock = vi.fn(async () => ({ id: 1 } as never))
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host}>
        <MockEditorPanel
          createMock={createMock}
          updateMock={vi.fn(async () => true)}
          initialData={{ name: 'broken', urlPattern: '([unclosed' }}
        />
      </EditorPaneActionsProvider>,
    )

    await user.click(within(host).getByRole('button', { name: '保存' }))
    expect(createMock).not.toHaveBeenCalled()
    expect(screen.getByText('URL 匹配不是合法的正则表达式')).toBeInTheDocument()
    host.remove()
  })

  it('names match fields without the parenthetical and keeps format actions as icon buttons', async () => {
    const user = userEvent.setup()
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host}>
        <MockEditorPanel
          createMock={vi.fn(async () => null)}
          updateMock={vi.fn(async () => true)}
          initialData={{ urlPattern: '/cart', query: 'a=1', body: '{"ok":true}' }}
        />
      </EditorPaneActionsProvider>,
    )

    expect(screen.getByRole('textbox', { name: 'URL 匹配' })).toHaveValue('/cart')
    expect(screen.getByRole('textbox', { name: 'Query 匹配' })).toHaveValue('a=1')
    expect(screen.queryByText('URL 匹配（支持正则）')).not.toBeInTheDocument()
    expect(screen.queryByText('Query 匹配（可选）')).not.toBeInTheDocument()

    const urlHint = screen.getByRole('button', { name: 'URL 匹配说明' })
    await user.hover(urlHint)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('支持正则')

    const queryHint = screen.getByRole('button', { name: 'Query 匹配说明' })
    await user.hover(queryHint)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('可选')

    const format = screen.getByRole('button', { name: '代码格式化' })
    const fix = screen.getByRole('button', { name: 'AI修复' })
    expect(format).not.toHaveTextContent('代码格式化')
    expect(fix).not.toHaveTextContent('AI修复')
    expect(within(host).getByRole('button', { name: '保存' })).toHaveTextContent('保存')
    host.remove()
  })

  it('fills remaining height by default, then keeps a dragged height until double-click restores fill', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host}>
        <MockEditorPanel
          createMock={vi.fn(async () => null)}
          updateMock={vi.fn(async () => true)}
          initialData={{ urlPattern: '/cart' }}
        />
      </EditorPaneActionsProvider>,
    )

    const frame = screen.getByTestId('mock-body-editor-frame')
    expect(frame).toHaveClass('flex-1', 'min-h-[150px]')
    expect(frame).not.toHaveAttribute('style')

    const scroll = document.querySelector('[data-slot="mock-editor-scroll"]')
    expect(scroll).toHaveClass('app-panel-content')
    expect(scroll).toHaveClass('max-[640px]:pb-[calc(var(--ui-panel-padding)+var(--ui-section-gap))]')
    expect(scroll).toContainElement(frame)
    expect(scroll).toContainElement(screen.getByText('启用此规则'))

    Object.defineProperty(frame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 280, width: 400, top: 0, left: 0, bottom: 280, right: 400, x: 0, y: 0, toJSON: () => {} }),
    })

    const handle = screen.getByTestId('mock-body-editor-resize')
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 160 })
    fireEvent.mouseUp(document)

    expect(frame).toHaveStyle({ height: '340px' })
    expect(frame).toHaveClass('shrink-0')
    expect(frame).not.toHaveClass('flex-1')

    fireEvent.doubleClick(handle)
    expect(frame).toHaveClass('flex-1', 'min-h-[150px]')
    expect(frame.style.height).toBe('')
    host.remove()
  })
})

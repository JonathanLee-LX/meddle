import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
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
})

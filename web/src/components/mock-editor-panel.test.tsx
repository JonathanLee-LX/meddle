import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    expect(host).toHaveTextContent('保存')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    host.remove()
  })
})

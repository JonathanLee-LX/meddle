import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorPaneActionsProvider } from './editor-pane-actions'
import { PluginTestDialog } from './plugin-test-dialog'

vi.mock('./monaco-editor', () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="plugin-test-code">{value}</pre>,
  MonacoDiffEditor: () => null,
}))

describe('PluginTestDialog embedded code', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/code')) {
          return { ok: true, json: async () => ({ code: 'exports.plugin = { manifest: { id: "local.demo" } }' }) }
        }
        return { ok: true, json: async () => ({}) }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads plugin source when embedded without the sheet open flag', async () => {
    render(
      <PluginTestDialog
        embedded
        plainHeading
        pluginId="local.demo"
        pluginName="Demo"
        hooks={['onRequest']}
      />,
    )

    expect(await screen.findByTestId('plugin-test-code')).toHaveTextContent('exports.plugin')
    expect(screen.queryByText('发起真实 HTTP 请求，在请求/响应过程中运行插件代码')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('places the test action in the pane title bar', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <EditorPaneActionsProvider host={host}>
        <PluginTestDialog embedded plainHeading pluginId="local.demo" pluginName="Demo" hooks={['onRequest']} />
      </EditorPaneActionsProvider>,
    )

    expect(await screen.findByTestId('plugin-test-code')).toHaveTextContent('exports.plugin')
    expect(host).toHaveTextContent('发起测试请求')
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument()
    host.remove()
  })
})
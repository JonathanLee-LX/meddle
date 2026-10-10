import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { PluginConfig } from './plugin-config'
import type { Plugin } from '@/types'
import { PLUGIN_LIST_DEFAULT_PX, PLUGIN_LIST_STORAGE_KEY } from '@/lib/plugin-pane-split'

vi.mock('./plugin-code-editor', () => ({
  PluginCodeEditor: ({ filename }: { filename: string }) => <div data-testid="plugin-code-stub">{filename}</div>,
}))

vi.mock('./plugin-generator', () => ({
  PluginGenerator: () => <div data-testid="plugin-generate-stub">generate</div>,
}))

vi.mock('./plugin-test-dialog', () => ({
  PluginTestDialog: ({ pluginName }: { pluginName: string }) => <div data-testid="plugin-test-stub">{pluginName}</div>,
}))

const builtin: Plugin = {
  id: 'builtin.logger',
  name: 'Logger',
  version: '1.0.0',
  hooks: ['onRequest'],
  permissions: [],
  priority: 0,
  state: 'stopped',
  stats: null,
}

const loadedCustom: Plugin = {
  id: 'local.demo',
  name: 'Demo',
  version: '0.1.0',
  hooks: ['onResponse'],
  permissions: [],
  priority: 0,
  state: 'running',
  stats: null,
}

function renderPlugins(plugins: Plugin[] = [builtin, loadedCustom]) {
  return render(
    <div style={{ height: 600 }}>
      <PluginConfig
        plugins={plugins}
        pluginMode="on"
        switchPluginMode={vi.fn(async () => undefined)}
        fetchPlugins={vi.fn(async () => undefined)}
        startPlugin={vi.fn(async () => undefined)}
        stopPlugin={vi.fn(async () => undefined)}
        togglePlugin={vi.fn(async () => undefined)}
        thirdPartyPlugins={[]}
        thirdPartySecurity={{ allowAll: false, trusted: [] }}
        fetchThirdPartyPlugins={vi.fn(async () => undefined)}
        loadThirdPartyPlugin={vi.fn(async () => undefined)}
        unloadThirdPartyPlugin={vi.fn(async () => undefined)}
      />
    </div>,
  )
}

describe('PluginConfig list|edit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ plugins: [{ filename: 'demo.js', modified: Date.now() }] }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem(PLUGIN_LIST_STORAGE_KEY)
  })

  it('renders the shared split and an idle editor', async () => {
    renderPlugins()
    expect(screen.getByTestId('plugin-config-layout')).toHaveAttribute('data-layout', 'list-edit')
    expect(screen.getByTestId('plugin-config-list')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-config-edit')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-panel-separator')).toBeInTheDocument()
    expect(screen.getByText(/选择左侧插件/)).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-code-stub')).not.toBeInTheDocument()
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('opens the built-in plugin in the right pane', async () => {
    renderPlugins()
    fireEvent.click(screen.getByTestId('plugin-config-row-builtin-builtin.logger'))
    expect(screen.getByTestId('plugin-config-row-builtin-builtin.logger')).toHaveAttribute('data-state', 'selected')
    const edit = screen.getByTestId('plugin-config-edit')
    expect(edit).toHaveTextContent('builtin.logger · 1.0.0')
    expect(within(edit).getByRole('button', { name: '启动插件 Logger' })).toBeInTheDocument()
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('opens the code editor for a custom plugin and the generator from the toolbar', async () => {
    renderPlugins()
    fireEvent.click(await screen.findByTestId('plugin-config-row-custom-demo.js'))
    expect(await screen.findByTestId('plugin-code-stub')).toHaveTextContent('demo.js')

    fireEvent.click(screen.getByTestId('plugin-config-generate'))
    expect(await screen.findByTestId('plugin-generate-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-code-stub')).not.toBeInTheDocument()
  })

  it('opens the test panel from the custom row without leaving the page', async () => {
    renderPlugins()
    fireEvent.click(await screen.findByRole('button', { name: '测试插件 Demo' }))
    expect(await screen.findByTestId('plugin-test-stub')).toHaveTextContent('Demo')
  })

  it('remembers the list width separately from other panes', async () => {
    localStorage.removeItem(PLUGIN_LIST_STORAGE_KEY)
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    renderPlugins()
    const layout = screen.getByTestId('plugin-config-layout')
    const list = screen.getByTestId('plugin-config-list')
    expect(layout).toHaveAttribute('data-plugin-list-width', String(PLUGIN_LIST_DEFAULT_PX))
    expect(list).toHaveStyle({ width: `${PLUGIN_LIST_DEFAULT_PX}px`, flex: `0 0 ${PLUGIN_LIST_DEFAULT_PX}px` })

    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1400, top: 0, height: 800, right: 1400, bottom: 800, x: 0, y: 0, toJSON: () => {} }),
    })

    fireEvent.mouseDown(screen.getByTestId('plugin-panel-separator'))
    act(() => {
      fireEvent.mouseMove(document, { clientX: 420 })
      fireEvent.mouseUp(document)
    })

    expect(localStorage.getItem(PLUGIN_LIST_STORAGE_KEY)).toBe('420')
    expect(layout).toHaveAttribute('data-plugin-list-width', '420')
    expect(await screen.findByTestId('plugin-config-row-custom-demo.js')).toBeInTheDocument()
  })

  it('shows a custom plugin whose id is not local.<file> only in the custom group (#112)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          plugins: [{ filename: 'add-trace-header.js', modified: Date.now(), pluginId: 'add-trace-header' }],
        }),
      })),
    )
    const traceHeader: Plugin = {
      id: 'add-trace-header',
      name: 'Add Trace Header',
      version: '1.0.0',
      hooks: ['onBeforeProxy'],
      permissions: [],
      priority: 100,
      state: 'running',
      stats: null,
      source: 'custom',
      filename: 'add-trace-header.js',
    }
    renderPlugins([{ ...builtin, source: 'builtin' }, traceHeader])

    const customRow = await screen.findByTestId('plugin-config-row-custom-add-trace-header.js')
    expect(within(customRow).getByText('已启用')).toBeInTheDocument()
    expect(within(customRow).queryByText('未加载')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-config-row-builtin-add-trace-header')).not.toBeInTheDocument()
    expect(screen.getByTestId('plugin-config-row-builtin-builtin.logger')).toBeInTheDocument()
  })
})

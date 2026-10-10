import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginConfig } from './plugin-config'
import type { Plugin } from '@/types'
import { installViewport } from '@/test/viewport'

vi.mock('./plugin-code-editor', () => ({ PluginCodeEditor: () => null }))
vi.mock('./plugin-generator', () => ({ PluginGenerator: () => null }))
vi.mock('./plugin-test-dialog', () => ({ PluginTestDialog: () => null }))

const realMatchMedia = window.matchMedia

const third: Plugin = {
  id: 'vendor.audit',
  name: 'Vendor Audit',
  version: '2.0.0',
  hooks: ['onRequest'],
  permissions: [],
  priority: 0,
  state: 'running',
  stats: null,
}

function renderPlugins(thirdPartyPlugins: Plugin[] = []) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ plugins: [] }) })))
  return render(
    <PluginConfig
      plugins={[]}
      pluginMode="on"
      switchPluginMode={vi.fn(async () => undefined)}
      fetchPlugins={vi.fn(async () => undefined)}
      startPlugin={vi.fn(async () => undefined)}
      stopPlugin={vi.fn(async () => undefined)}
      togglePlugin={vi.fn(async () => undefined)}
      thirdPartyPlugins={thirdPartyPlugins}
      thirdPartySecurity={{ allowAll: false, trusted: [] }}
      fetchThirdPartyPlugins={vi.fn(async () => undefined)}
      loadThirdPartyPlugin={vi.fn(async () => undefined)}
      unloadThirdPartyPlugin={vi.fn(async () => undefined)}
    />,
  )
}

describe('PluginConfig at narrow widths (#109)', () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia
    vi.unstubAllGlobals()
  })

  it('keeps list | editor side by side at 900px with the 第三方插件 group in the full-height list', () => {
    installViewport(900)
    renderPlugins([third])
    const list = screen.getByTestId('plugin-config-list')
    // Side by side: a pixel-width column, not the stacked 46% strip that clipped the group.
    expect(list.style.width).not.toBe('')
    expect(list).toHaveClass('md:max-h-none')
    expect(screen.getByTestId('plugin-config-layout')).toHaveClass('md:flex-row')
    const group = within(list).getByText('第三方插件').closest('section') as HTMLElement
    expect(group).toBeInTheDocument()
    expect(within(group).getByTestId('plugin-config-row-third-vendor.audit')).toBeInTheDocument()
    expect(within(group).getByTestId('plugin-config-load')).toBeInTheDocument()
  })

  it('stacks below 768px and still renders the 第三方插件 group', () => {
    installViewport(700)
    renderPlugins()
    const list = screen.getByTestId('plugin-config-list')
    expect(list.style.width).toBe('')
    expect(within(list).getByText('第三方插件')).toBeInTheDocument()
    expect(within(list).getByText('暂无第三方插件')).toBeInTheDocument()
  })

  it('switches to side by side at exactly 768px', () => {
    installViewport(768)
    renderPlugins()
    expect(screen.getByTestId('plugin-config-list').style.width).not.toBe('')
  })
})

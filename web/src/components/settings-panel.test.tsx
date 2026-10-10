import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './settings-panel'

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    theme: 'system',
    accentColor: 'auto',
    setTheme: vi.fn(),
    setAccentColor: vi.fn(),
    setZoom: vi.fn(),
  }),
}))

vi.mock('@/lib/settings-store', () => ({
  getCachedSettings: () => ({ fontSize: '100' }),
  loadSettings: vi.fn().mockResolvedValue({
    fontSize: '100',
    mocksFilePath: '',
    clientAliases: {},
    aiConfig: {
      enabled: false,
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: '',
      models: [],
    },
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsPanel navigation', () => {
  it('renders settings categories as a vertical sidebar and switches content', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', {
      headers: { 'Content-Type': 'application/json' },
    })))

    render(<SettingsPanel embedded />)

    const navigation = screen.getByRole('tablist', { name: '设置分类' })
    expect(navigation).toHaveAttribute('data-orientation', 'vertical')
    expect(navigation).toHaveClass('group-data-[orientation=vertical]/tabs:!h-full')
    expect(within(navigation).getAllByRole('tab')).toHaveLength(4)
    expect(screen.getByText('主题')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: '偏好设置' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: '配置文件' }))

    expect(await screen.findByText('路由规则文件')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: '配置文件' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: '客户端' }))
    expect(screen.getByRole('tabpanel', { name: '客户端' })).toHaveClass('app-panel-content')

    await user.click(within(navigation).getByRole('tab', { name: 'AI 配置' }))
    expect(screen.getByRole('tabpanel', { name: 'AI 配置' })).toHaveClass('app-panel-content')
  })
})

describe('SettingsPanel about section (#112)', () => {
  it('shows the Meddle version reported by /api/version instead of a hardcoded 1.0.0', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url === '/api/version' ? { name: '@jonathanleelx/meddle', version: '0.5.0-beta.18' } : []
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsPanel embedded />)

    expect(await screen.findByText('版本: 0.5.0-beta.18')).toBeInTheDocument()
    expect(screen.queryByText('版本: 1.0.0')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/version')
  })

  it('shows a placeholder rather than a fake version when /api/version is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    render(<SettingsPanel embedded />)

    expect(await screen.findByTestId('settings-app-version')).toHaveTextContent('版本: —')
    expect(screen.queryByText('版本: 1.0.0')).not.toBeInTheDocument()
  })
})

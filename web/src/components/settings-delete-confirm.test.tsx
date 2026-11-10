import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './settings-panel'
import { loadSettings, updateSettings } from '@/lib/settings-store'

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    theme: 'system',
    accentColor: 'auto',
    setTheme: vi.fn(),
    setAccentColor: vi.fn(),
    setZoom: vi.fn(),
  }),
}))

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const MODEL = {
  id: 'm1',
  name: '日常模型',
  provider: 'openai' as const,
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
}

const SETTINGS = {
  theme: 'light' as const,
  accentColor: 'auto' as const,
  fontSize: '100',
  mocksFilePath: '',
  clientAliases: { '10.0.0.8': 'iPhone' },
  aiConfig: {
    enabled: true,
    provider: 'openai' as const,
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    models: [MODEL],
    activeModelId: 'm1',
  },
}

vi.mock('@/lib/settings-store', () => ({
  getCachedSettings: () => ({ fontSize: '100' }),
  loadSettings: vi.fn(),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}))

function writes(key: 'clientAliases' | 'aiConfig') {
  return vi.mocked(updateSettings).mock.calls.filter(([updates]) => Boolean(updates && key in updates))
}

beforeEach(() => {
  vi.mocked(loadSettings).mockReset()
  vi.mocked(loadSettings).mockResolvedValue(SETTINGS)
  vi.mocked(updateSettings).mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })))
})

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  render(<SettingsPanel embedded />)
  await user.click(screen.getByRole('tab', { name }))
}

describe('settings device name delete confirmation', () => {
  it('keeps the device and does not write clientAliases when 取消 or 关闭 is used', async () => {
    const user = userEvent.setup()
    await openTab(user, '客户端')
    expect(await screen.findByDisplayValue('iPhone')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除设备名称' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除设备名称' })
    expect(screen.getByDisplayValue('iPhone')).toBeInTheDocument()
    expect(writes('clientAliases')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('iPhone')).toBeInTheDocument()
    expect(writes('clientAliases')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '删除设备名称' }))
    const again = await screen.findByRole('alertdialog', { name: '删除设备名称' })
    await user.click(within(again).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('10.0.0.8')).toBeInTheDocument()
    expect(writes('clientAliases')).toHaveLength(0)
  })

  it('removes the device only after 删除, and the settings write waits for 保存客户端名称', async () => {
    const user = userEvent.setup()
    await openTab(user, '客户端')
    expect(await screen.findByDisplayValue('iPhone')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除设备名称' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除设备名称' })
    expect(writes('clientAliases')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(screen.queryByDisplayValue('iPhone')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(writes('clientAliases')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '保存客户端名称' }))
    await waitFor(() => expect(writes('clientAliases')).toHaveLength(1))
    expect(writes('clientAliases')[0][0]).toEqual({ clientAliases: {} })
    expect(writes('aiConfig')).toHaveLength(0)
  })
})

describe('settings model delete confirmation', () => {
  it('keeps the model when Escape is pressed and writes aiConfig only after an explicit save', async () => {
    const user = userEvent.setup()
    await openTab(user, 'AI 配置')
    expect(await screen.findByText('日常模型')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除模型' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除模型' })
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByText('日常模型')).toBeInTheDocument()
    expect(writes('aiConfig')).toHaveLength(0)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('日常模型')).toBeInTheDocument()
    expect(writes('aiConfig')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '删除模型' }))
    const again = await screen.findByRole('alertdialog', { name: '删除模型' })
    await user.click(within(again).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByText('日常模型')).not.toBeInTheDocument())
    expect(writes('aiConfig')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(writes('aiConfig')).toHaveLength(1))
    const saved = writes('aiConfig')[0][0].aiConfig
    expect(saved?.models).toEqual([])
    expect(saved?.models?.some((model) => model.id === 'm1')).toBe(false)
    expect(writes('clientAliases')).toHaveLength(0)
  })
})

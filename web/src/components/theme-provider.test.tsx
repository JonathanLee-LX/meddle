import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedSettings, loadSettings, updateSettings } from '@/lib/settings-store'
import { ThemeProvider, useTheme } from './theme-provider'

vi.mock('@/lib/settings-store', () => ({
  getCachedSettings: vi.fn(),
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const settings = {
  theme: 'system' as const,
  accentColor: 'auto' as const,
  fontSize: '100',
  aiConfig: {
    enabled: false,
    provider: 'openai' as const,
    apiKey: '',
    baseUrl: '',
    model: '',
    models: [],
  },
}

function ThemeHarness() {
  const { accentColor, resolvedTheme, setAccentColor } = useTheme()
  return (
    <button onClick={() => setAccentColor('rose')}>
      {accentColor}:{resolvedTheme}
    </button>
  )
}

beforeEach(() => {
  vi.mocked(getCachedSettings).mockReturnValue(settings)
  vi.mocked(loadSettings).mockResolvedValue(settings)
  vi.mocked(updateSettings).mockResolvedValue()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  document.documentElement.className = ''
  delete document.documentElement.dataset.accent
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ThemeProvider accent color', () => {
  it('applies auto mode and persists a selected accent color', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    )

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('auto'))

    await user.click(screen.getByRole('button', { name: 'auto:light' }))

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe('rose')
      expect(updateSettings).toHaveBeenLastCalledWith({
        theme: 'system',
        accentColor: 'rose',
      })
    })
  })

  it('updates the resolved theme when the system scheme changes', async () => {
    let matches = false
    let listener: (() => void) | undefined
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() {
        return matches
      },
      addEventListener: (_event: string, handler: () => void) => {
        listener = handler
      },
      removeEventListener: vi.fn(),
    }))

    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    )

    expect(screen.getByRole('button')).toHaveTextContent('auto:light')
    matches = true
    act(() => {
      listener?.()
    })
    expect(screen.getByRole('button')).toHaveTextContent('auto:dark')
  })
})

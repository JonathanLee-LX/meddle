import * as React from "react"
import { loadSettings, updateSettings, getCachedSettings } from '@/lib/settings-store'
import type { AccentColor } from '@/lib/settings-store'

type Theme = "light" | "dark" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: "light" | "dark"
  accentColor: AccentColor
  setTheme: (theme: Theme) => void
  setAccentColor: (accentColor: AccentColor) => void
  toggleTheme: () => void
  setZoom: (zoom: number) => void
}

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

function settingsFontSizeToZoom(fontSize?: string): number {
  if (!fontSize) return 1

  const legacyFontSizes: Record<string, number> = {
    small: 0.9,
    medium: 1,
    large: 1.1,
  }

  if (fontSize in legacyFontSizes) return legacyFontSizes[fontSize]

  const numericValue = Number(fontSize)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 1
  return numericValue > 10 ? numericValue / 100 : numericValue
}

// 获取系统主题
function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") {
      return defaultTheme
    }
    const settings = getCachedSettings()
    return settings.theme || defaultTheme
  })
  const [accentColor, setAccentColorState] = React.useState<AccentColor>(() => {
    if (typeof window === 'undefined') return 'auto'
    return getCachedSettings().accentColor || 'auto'
  })

  const [loaded, setLoaded] = React.useState(false)

  // 用于外部调用的缩放函数
  const setZoom = React.useCallback((zoom: number) => {
    // 缩放 rem-based UI，避免 CSS zoom/transform 影响 Radix Select 弹层定位。
    const root = window.document.documentElement
    root.style.setProperty('--app-scale', String(zoom))
  }, [])

  // 初始化时从服务器加载设置
  React.useEffect(() => {
    loadSettings().then(settings => {
      setThemeState(settings.theme || defaultTheme)
      setAccentColorState(settings.accentColor || 'auto')
      setZoom(settingsFontSizeToZoom(settings.fontSize))
      setLoaded(true)
    }).catch(() => {
      setLoaded(true)
    })
  }, [defaultTheme, setZoom])

  // 计算实际应该使用的主题
  const resolvedTheme = theme === "system" ? getSystemTheme() : theme

  React.useEffect(() => {
    if (!loaded) return

    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolvedTheme)
    root.dataset.accent = accentColor
    
    // 保存到文件系统
    updateSettings({ theme, accentColor }).catch(console.error)
  }, [theme, resolvedTheme, accentColor, loaded])

  // 监听系统主题变化
  React.useEffect(() => {
    if (theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      // 强制重新渲染以更新 resolvedTheme
      const root = window.document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(getSystemTheme())
    }

    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [theme])

  const setTheme = React.useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  const setAccentColor = React.useCallback((newAccentColor: AccentColor) => {
    setAccentColorState(newAccentColor)
  }, [])

  const toggleTheme = React.useCallback(() => {
    setThemeState((prevTheme) => {
      if (prevTheme === "light") return "dark"
      if (prevTheme === "dark") return "system"
      return "light"
    })
  }, [])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      accentColor,
      setTheme,
      setAccentColor,
      toggleTheme,
      setZoom,
    }),
    [theme, resolvedTheme, accentColor, setTheme, setAccentColor, toggleTheme, setZoom]
  )

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

// ThemeProvider and its hook intentionally share the same module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = React.useContext(ThemeProviderContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

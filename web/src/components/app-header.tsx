import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AIConfigBadge } from '@/components/ai-settings'
import { useTheme } from '@/components/theme-provider'
import { SessionSwitcher } from '@/components/session-switcher'
import { Command, Globe, Moon, Sun, Settings, Monitor, QrCode } from 'lucide-react'

interface AppHeaderProps {
  onSettingsClick: () => void
  onCommandClick: () => void
  onMobileProxyClick: () => void
}

/**
 * Application header component
 * Displays app title, theme toggle, and settings button
 */
export function AppHeader({ onSettingsClick, onCommandClick, onMobileProxyClick }: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 lg:px-6">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Globe className="size-4" />
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold tracking-tight">Meddle</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">开发代理工具</span>
        </div>
        <div className="flex-1" />
        <AIConfigBadge />
        <SessionSwitcher />
        <Button variant="outline" size="sm" onClick={onMobileProxyClick} title="手机代理与二维码">
          <QrCode data-icon="inline-start" />
          <span className="hidden sm:inline">手机代理</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onCommandClick} className="hidden sm:inline-flex" title="打开全局操作面板">
          <Command data-icon="inline-start" />
          操作
          <Badge variant="secondary">⌘K</Badge>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onSettingsClick} aria-label="设置">
          <Settings />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={`当前主题: ${theme}，点击切换`}
          title={`主题: ${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}`}
        >
          {theme === 'light' ? <Moon /> : theme === 'dark' ? <Sun /> : <Monitor />}
        </Button>
      </div>
    </header>
  )
}

import { Button } from '@/components/ui/button'
import { AIConfigBadge } from '@/components/ai-settings'
import { useTheme } from '@/components/theme-provider'
import { Command, Globe, Moon, Sun, Settings, Monitor } from 'lucide-react'

interface AppHeaderProps {
  onSettingsClick: () => void
  onCommandClick: () => void
}

/**
 * Application header component
 * Displays app title, theme toggle, and settings button
 */
export function AppHeader({ onSettingsClick, onCommandClick }: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
        <Globe className="h-5 w-5 text-primary" />
        <h1 className="text-sm font-semibold">Easy Proxy</h1>
        <span className="text-xs text-muted-foreground">开发代理工具</span>
        <div className="flex-1" />
        <AIConfigBadge />
        <Button
          variant="outline"
          size="sm"
          onClick={onCommandClick}
          className="hidden h-8 gap-2 px-2 text-xs sm:inline-flex"
          title="打开全局操作面板"
        >
          <Command className="h-3.5 w-3.5" />
          操作
          <span className="rounded border bg-muted px-1 text-[10px] text-muted-foreground">⌘K</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onSettingsClick}
          className="h-8 w-8"
          aria-label="设置"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-8 w-8"
          aria-label={`当前主题: ${theme}，点击切换`}
          title={`主题: ${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}`}
        >
          {theme === 'light' ? (
            <Moon className="h-4 w-4" />
          ) : theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Monitor className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  )
}

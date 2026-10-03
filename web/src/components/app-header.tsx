import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AIConfigBadge } from '@/components/ai-settings'
import { useTheme } from '@/components/theme-provider'
import { SessionSwitcher } from '@/components/session-switcher'
import { SHELL_NAV, getPrimaryNavTab, type ShellTab } from '@/lib/shell-mode'
import { Activity, ClipboardList, Command, FileText, Globe, Moon, Sun, Settings, Monitor, Plug, QrCode } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const TAB_ICONS: Record<Exclude<ShellTab, 'settings' | 'mobile'>, LucideIcon> = {
  logs: Globe,
  config: FileText,
  mock: ClipboardList,
  plugins: Plug,
  health: Activity,
}

interface AppHeaderProps {
  activeTab: ShellTab
  onTabChange: (tab: ShellTab) => void
  mockEnabledCount?: number
  onSettingsClick: () => void
  onCommandClick: () => void
  onMobileProxyClick: () => void
}

/**
 * Application shell header — logo + primary nav (work ↔ config) + utilities.
 * Wireframe: modules/07-shell (顶栏 Tab 整页切换，两套布局不同时叠)
 */
export function AppHeader({
  activeTab,
  onTabChange,
  mockEnabledCount = 0,
  onSettingsClick,
  onCommandClick,
  onMobileProxyClick,
}: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme()
  const primaryActive = getPrimaryNavTab(activeTab)
  const settingsActive = activeTab === 'settings'
  const mobileActive = activeTab === 'mobile'

  return (
    <header
      data-testid="app-shell-header"
      className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="flex h-14 w-full items-center gap-3 px-4 lg:px-6">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Globe className="size-4" />
        </div>
        <div className="flex min-w-0 shrink-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold tracking-tight">Meddle</h1>
          <span className="hidden text-xs text-muted-foreground xl:inline">开发代理工具</span>
        </div>

        <Tabs
          value={primaryActive ?? ''}
          onValueChange={(value) => onTabChange(value as ShellTab)}
          className="min-w-0 flex-1 gap-0 overflow-hidden"
        >
          <TabsList
            data-testid="app-shell-nav"
            aria-label="主导航"
            className="meddle-thin-scroll h-9 max-w-full justify-start overflow-x-auto"
          >
            {SHELL_NAV.map((item) => {
              const Icon = TAB_ICONS[item.tab as keyof typeof TAB_ICONS]
              const active = primaryActive === item.tab
              return (
                <TabsTrigger
                  key={item.tab}
                  value={item.tab}
                  data-testid={`shell-nav-${item.tab}`}
                  data-shell-nav-mode={item.mode}
                  title={item.title}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon aria-hidden />
                  <span>{item.label}</span>
                  {item.tab === 'mock' && mockEnabledCount > 0 ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {mockEnabledCount}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        <div className="flex shrink-0 items-center gap-2">
          <AIConfigBadge />
          <SessionSwitcher />
          <Button
            variant={mobileActive ? 'selected' : 'outline'}
            size="sm"
            onClick={onMobileProxyClick}
            title="手机代理与二维码"
            data-testid="shell-utility-mobile"
            data-state={mobileActive ? 'active' : 'inactive'}
            aria-current={mobileActive ? 'page' : undefined}
          >
            <QrCode data-icon="inline-start" />
            <span className="hidden sm:inline">手机代理</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onCommandClick} className="hidden sm:inline-flex" title="打开全局操作面板">
            <Command data-icon="inline-start" />
            操作
            <Badge variant="secondary">⌘K</Badge>
          </Button>
          <Button
            variant={settingsActive ? 'selected' : 'ghost'}
            size="icon-sm"
            onClick={onSettingsClick}
            aria-label="设置"
            data-testid="shell-utility-settings"
            data-state={settingsActive ? 'active' : 'inactive'}
            aria-current={settingsActive ? 'page' : undefined}
          >
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
      </div>
    </header>
  )
}

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AIConfigBadge } from '@/components/ai-settings'
import { useTheme } from '@/components/theme-provider'
import { SessionSwitcher } from '@/components/session-switcher'
import { SHELL_NAV, type ShellNavItem, type ShellTab } from '@/lib/shell-mode'
import { cn } from '@/lib/utils'
import { Activity, ClipboardList, FileText, Globe, Moon, Sun, Settings, Monitor, PanelLeftClose, PanelLeftOpen, Plug, QrCode, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Display-only. Fresh profiles stay expanded. */
export const SHELL_NAV_COLLAPSED_KEY = 'meddle-shell-nav-collapsed'

function readShellNavCollapsed() {
  try {
    return localStorage.getItem(SHELL_NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const TAB_ICONS: Record<ShellTab, LucideIcon> = {
  logs: Globe,
  config: FileText,
  mock: ClipboardList,
  plugins: Plug,
  health: Activity,
  mobile: QrCode,
  settings: Settings,
}

interface AppHeaderProps {
  onCommandClick: () => void
}

interface ShellNavProps {
  activeTab: ShellTab
  onTabChange: (tab: ShellTab) => void
  mockEnabledCount?: number
}

/**
 * Vertical primary nav. Sits in `.app-shell-main`, beside shell-work / shell-config.
 */
export function ShellNav({ activeTab, onTabChange, mockEnabledCount = 0 }: ShellNavProps) {
  const [collapsed, setCollapsed] = useState(readShellNavCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SHELL_NAV_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // Ignore private-mode storage failures. The rail still toggles in memory.
    }
  }, [collapsed])

  const renderItem = (item: ShellNavItem) => {
    const Icon = TAB_ICONS[item.tab]
    const active = activeTab === item.tab
    return (
      <TabsTrigger
        key={item.tab}
        value={item.tab}
        data-testid={`shell-nav-${item.tab}`}
        data-shell-nav-mode={item.mode}
        title={item.title}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'h-auto min-h-10 w-full flex-none gap-2.5 px-3.5 py-3',
          collapsed && 'justify-center px-2.5',
        )}
      >
        <Icon aria-hidden />
        <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
        {item.tab === 'mock' && mockEnabledCount > 0 ? (
          <Badge
            variant="secondary"
            className={cn(
              'h-5 px-1.5 text-[10px]',
              collapsed && 'absolute top-0.5 right-0.5 h-4 min-w-4 px-1',
            )}
          >
            {mockEnabledCount}
          </Badge>
        ) : null}
      </TabsTrigger>
    )
  }

  return (
    <div
      data-testid="app-shell-nav-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full min-h-0 w-fit shrink-0 flex-col self-stretch"
    >
      <Tabs
        orientation="vertical"
        value={activeTab}
        onValueChange={(value) => onTabChange(value as ShellTab)}
        className="h-full min-h-0 flex-1 flex-col"
      >
        <TabsList
          id="app-shell-nav"
          data-testid="app-shell-nav"
          aria-label="主导航"
          className="!h-full w-fit flex-col items-stretch justify-start gap-2.5 overflow-y-auto bg-transparent p-2.5"
        >
          {SHELL_NAV.map(renderItem)}
        </TabsList>
      </Tabs>
      <Button
        type="button"
        variant="ghost"
        size={collapsed ? 'icon' : 'sm'}
        className={cn('mt-2 shrink-0', collapsed ? 'size-10 self-center' : 'h-10 w-full justify-start px-3.5')}
        data-testid="shell-nav-collapse"
        aria-expanded={!collapsed}
        aria-controls="app-shell-nav"
        aria-label={collapsed ? '展开菜单' : '收起菜单'}
        title={collapsed ? '展开菜单' : '收起菜单'}
        onClick={() => setCollapsed((open) => !open)}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
    </div>
  )
}

/**
 * Application shell header — logo + utilities.
 * Primary nav lives in ShellNav beside the page.
 */
export function AppHeader({ onCommandClick }: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header
      data-testid="app-shell-header"
      className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="flex h-14 w-full items-center gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Globe className="size-4" />
          </div>
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight">Meddle</h1>
            <span className="hidden text-xs text-muted-foreground xl:inline">开发代理工具</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCommandClick}
          className="hidden h-9 w-72 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm text-muted-foreground shadow-xs outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:inline-flex"
          title="打开全局操作面板"
          data-testid="shell-command"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">搜索操作…</span>
          <Badge variant="secondary">⌘K</Badge>
        </button>

        <div data-testid="app-shell-utilities" className="ml-auto flex shrink-0 items-center gap-2">
          <AIConfigBadge />
          <SessionSwitcher />
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

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks/use-media-query'
import { AIConfigBadge } from '@/components/ai-settings'
import { useTheme } from '@/components/theme-provider'
import { SessionSwitcher } from '@/components/session-switcher'
import { SHELL_NAV, type ShellNavItem, type ShellTab } from '@/lib/shell-mode'
import { cn } from '@/lib/utils'
import { Activity, ClipboardList, FileText, Globe, Moon, Sun, Settings, Monitor, PanelLeftClose, PanelLeftOpen, Plug, QrCode, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Manual collapse preference (display only). Fresh profiles stay expanded.
 * Only an explicit toggle at >= SHELL_NAV_AUTO_COLLAPSE_PX writes it; the
 * narrow-viewport auto-collapse and the narrow overlay never touch it.
 */
export const SHELL_NAV_COLLAPSED_KEY = 'meddle-shell-nav-collapsed'

/** Below this viewport width the rail auto-collapses to icons (#109). */
export const SHELL_NAV_AUTO_COLLAPSE_PX = 1024
const SHELL_NAV_NARROW_QUERY = `(max-width: ${SHELL_NAV_AUTO_COLLAPSE_PX - 0.02}px)`

function readShellNavCollapsed() {
  try {
    return localStorage.getItem(SHELL_NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeShellNavCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SHELL_NAV_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Ignore private-mode storage failures. The rail still toggles in memory.
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
 *
 * - >= 1024px: expanded or collapsed per the user's manual (persisted) choice.
 * - < 1024px: auto-collapsed to an icon rail. Expanding it opens an overlay above
 *   the page (no push) that closes on outside click, Esc, or picking a page.
 * - Collapsed: each icon shows a tooltip with its page name.
 */
export function ShellNav({ activeTab, onTabChange, mockEnabledCount = 0 }: ShellNavProps) {
  const [manualCollapsed, setManualCollapsed] = useState(readShellNavCollapsed)
  const narrow = useMediaQuery(SHELL_NAV_NARROW_QUERY)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const overlay = narrow && overlayOpen
  const collapsed = narrow ? !overlayOpen : manualCollapsed

  // Crossing the breakpoint drops any transient overlay; the manual choice is untouched.
  const [prevNarrow, setPrevNarrow] = useState(narrow)
  if (prevNarrow !== narrow) {
    setPrevNarrow(narrow)
    setOverlayOpen(false)
  }

  useEffect(() => {
    if (!overlay) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && railRef.current?.contains(target)) return
      setOverlayOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOverlayOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [overlay])

  const toggle = () => {
    if (narrow) {
      setOverlayOpen((open) => !open)
      return
    }
    setManualCollapsed((current) => {
      const next = !current
      writeShellNavCollapsed(next)
      return next
    })
  }

  const handleTabChange = (value: string) => {
    onTabChange(value as ShellTab)
    if (overlay) setOverlayOpen(false)
  }

  const renderItem = (item: ShellNavItem) => {
    const Icon = TAB_ICONS[item.tab]
    const active = activeTab === item.tab
    const showBadge = item.tab === 'mock' && mockEnabledCount > 0
    // Tabs owns the button (TabsTrigger asChild → TooltipTrigger) so its
    // data-state="active" wins over the tooltip's open/closed data-state.
    const content = (
      <>
        <span className="relative inline-flex shrink-0" data-slot="shell-nav-icon">
          <Icon aria-hidden />
          {showBadge && collapsed ? (
            <Badge
              variant="secondary"
              data-testid="shell-nav-mock-badge"
              // Clear of the glyph: ~4px right of the icon's top-right corner.
              className="absolute -top-2 left-[calc(100%+2px)] h-4 min-w-4 px-0.5 text-[10px]"
            >
              {mockEnabledCount}
            </Badge>
          ) : null}
        </span>
        <span data-slot="shell-nav-label" className={collapsed ? 'sr-only' : undefined}>
          {item.label}
        </span>
        {showBadge && !collapsed ? (
          <Badge variant="secondary" data-testid="shell-nav-mock-badge" className="h-5 px-1.5 text-[10px]">
            {mockEnabledCount}
          </Badge>
        ) : null}
      </>
    )
    return (
      <Tooltip key={item.tab} {...(collapsed ? {} : { open: false })}>
        <TabsTrigger
          asChild
          value={item.tab}
          data-testid={`shell-nav-${item.tab}`}
          data-shell-nav-mode={item.mode}
          // Collapsed: the tooltip names the page; a native title would double it.
          title={collapsed ? undefined : item.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'h-auto min-h-10 w-full flex-none gap-2.5 px-3.5 py-3',
            collapsed && 'justify-center px-2.5',
          )}
        >
          <TooltipTrigger>{content}</TooltipTrigger>
        </TabsTrigger>
        <TooltipContent side="right" sideOffset={8} data-testid={`shell-nav-tooltip-${item.tab}`}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      ref={railRef}
      data-testid="app-shell-nav-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-narrow={narrow ? 'true' : 'false'}
      data-overlay={overlay ? 'true' : 'false'}
      className={cn('relative flex h-full min-h-0 shrink-0 flex-col self-stretch', narrow ? 'w-14' : 'w-fit')}
    >
      <div
        data-testid="app-shell-nav-panel"
        className={cn(
          'flex h-full min-h-0 flex-col',
          overlay && 'absolute inset-y-0 left-0 z-30 w-max border-r bg-background shadow-lg',
        )}
      >
        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={handleTabChange}
          className="h-full min-h-0 flex-1 flex-col"
        >
          <TabsList
            id="app-shell-nav"
            data-testid="app-shell-nav"
            aria-label="主导航"
            className={cn(
              '!h-full w-fit flex-col items-stretch justify-start gap-2.5 overflow-y-auto bg-transparent p-2.5',
              collapsed && 'w-14 overflow-x-hidden',
            )}
          >
            {SHELL_NAV.map(renderItem)}
          </TabsList>
        </Tabs>
        <Button
          ref={toggleRef}
          type="button"
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          className={cn('mt-2 shrink-0', collapsed ? 'size-10 self-center' : 'h-10 w-full justify-start px-3.5')}
          data-testid="shell-nav-collapse"
          aria-expanded={!collapsed}
          aria-controls="app-shell-nav"
          aria-label={collapsed ? '展开菜单' : '收起菜单'}
          title={collapsed ? '展开菜单' : '收起菜单'}
          onClick={toggle}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
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

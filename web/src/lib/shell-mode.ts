/**
 * App shell mode helpers — work (traffic B host) vs config (full-width).
 * Wireframe: modules/07-shell · modules/01–06 (P3 full-width config)
 */

export type ShellTab = 'logs' | 'config' | 'mock' | 'plugins' | 'health' | 'settings' | 'mobile'
export type ShellMode = 'work' | 'config'

export interface ShellNavItem {
  tab: ShellTab
  path: string
  label: string
  mode: ShellMode
  title: string
}

/** Top-bar primary nav (left of utility actions). Settings / mobile open from the right. */
export const SHELL_NAV: readonly ShellNavItem[] = [
  {
    tab: 'logs',
    path: '/logs',
    label: '流量',
    mode: 'work',
    title: '查看经过代理的本机、远程设备和插件测试流量',
  },
  {
    tab: 'config',
    path: '/config',
    label: '路由规则',
    mode: 'config',
    title: '管理代理转发规则，并在表格、文本和图表视图间切换',
  },
  {
    tab: 'mock',
    path: '/mock',
    label: 'Mock',
    mode: 'config',
    title: '匹配请求后返回本地响应，用于联调和异常场景测试',
  },
  {
    tab: 'plugins',
    path: '/plugins',
    label: '扩展插件',
    mode: 'config',
    title: '控制内置、自定义和第三方插件的运行状态',
  },
  {
    tab: 'health',
    path: '/health',
    label: '健康',
    mode: 'config',
    title: '查看进程健康、连接、守护策略和日志限流状态',
  },
] as const

/** Utility config routes opened from header right (full-width config host, not primary nav). */
export const SHELL_UTILITY_TABS = ['settings', 'mobile'] as const
export type ShellUtilityTab = (typeof SHELL_UTILITY_TABS)[number]

const PATH_TO_TAB: Record<string, ShellTab> = {
  '/': 'logs',
  '/logs': 'logs',
  '/config': 'config',
  '/mock': 'mock',
  '/plugins': 'plugins',
  '/health': 'health',
  '/settings': 'settings',
  '/mobile': 'mobile',
}

const TAB_TO_PATH: Record<ShellTab, string> = {
  logs: '/logs',
  config: '/config',
  mock: '/mock',
  plugins: '/plugins',
  health: '/health',
  settings: '/settings',
  mobile: '/mobile',
}

export function getTabFromPath(pathname: string): ShellTab {
  return PATH_TO_TAB[pathname] ?? 'logs'
}

export function getPathForTab(tab: string): string {
  return TAB_TO_PATH[tab as ShellTab] ?? '/logs'
}

export function getShellMode(tab: ShellTab): ShellMode {
  return tab === 'logs' ? 'work' : 'config'
}

export function isWorkModeTab(tab: ShellTab): boolean {
  return getShellMode(tab) === 'work'
}

export function isUtilityConfigTab(tab: ShellTab): tab is ShellUtilityTab {
  return (SHELL_UTILITY_TABS as readonly string[]).includes(tab)
}

/** Primary nav highlight — utility tabs leave primary nav inactive. */
export function getPrimaryNavTab(tab: ShellTab): ShellTab | null {
  return isUtilityConfigTab(tab) ? null : tab
}

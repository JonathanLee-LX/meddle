import { describe, expect, it } from 'vitest'
import {
  SHELL_NAV,
  getPathForTab,
  getPrimaryNavTab,
  getShellMode,
  getTabFromPath,
  isUtilityConfigTab,
  isWorkModeTab,
} from './shell-mode'

describe('shell-mode', () => {
  it('maps paths to tabs (including / → logs)', () => {
    expect(getTabFromPath('/')).toBe('logs')
    expect(getTabFromPath('/logs')).toBe('logs')
    expect(getTabFromPath('/config')).toBe('config')
    expect(getTabFromPath('/mock')).toBe('mock')
    expect(getTabFromPath('/plugins')).toBe('plugins')
    expect(getTabFromPath('/health')).toBe('health')
    expect(getTabFromPath('/settings')).toBe('settings')
    expect(getTabFromPath('/mobile')).toBe('mobile')
    expect(getTabFromPath('/unknown')).toBe('logs')
  })

  it('maps tabs to paths', () => {
    expect(getPathForTab('logs')).toBe('/logs')
    expect(getPathForTab('config')).toBe('/config')
    expect(getPathForTab('mock')).toBe('/mock')
    expect(getPathForTab('plugins')).toBe('/plugins')
    expect(getPathForTab('health')).toBe('/health')
    expect(getPathForTab('settings')).toBe('/settings')
    expect(getPathForTab('mobile')).toBe('/mobile')
    expect(getPathForTab('nope')).toBe('/logs')
  })

  it('treats only traffic (logs) as work mode; all others are config', () => {
    expect(getShellMode('logs')).toBe('work')
    expect(isWorkModeTab('logs')).toBe(true)
    for (const tab of ['config', 'mock', 'plugins', 'health', 'settings', 'mobile'] as const) {
      expect(getShellMode(tab)).toBe('config')
      expect(isWorkModeTab(tab)).toBe(false)
    }
  })

  it('exposes shell nav labels matching 07-shell wireframe', () => {
    expect(SHELL_NAV.map((item) => item.label)).toEqual([
      '流量',
      '路由规则',
      'Mock',
      '扩展插件',
      '健康',
    ])
    expect(SHELL_NAV.find((item) => item.tab === 'logs')?.mode).toBe('work')
    expect(SHELL_NAV.filter((item) => item.mode === 'config')).toHaveLength(4)
    // Settings / mobile are utility config routes, not primary nav
    expect(SHELL_NAV.some((item) => item.tab === 'settings')).toBe(false)
    expect(SHELL_NAV.some((item) => item.tab === 'mobile')).toBe(false)
  })

  it('marks settings/mobile as utility config tabs (full-width host)', () => {
    expect(isUtilityConfigTab('settings')).toBe(true)
    expect(isUtilityConfigTab('mobile')).toBe(true)
    expect(isUtilityConfigTab('config')).toBe(false)
    expect(getPrimaryNavTab('settings')).toBeNull()
    expect(getPrimaryNavTab('mobile')).toBeNull()
    expect(getPrimaryNavTab('mock')).toBe('mock')
    expect(getPrimaryNavTab('logs')).toBe('logs')
  })
})

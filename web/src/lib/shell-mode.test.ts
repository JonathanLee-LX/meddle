import { describe, expect, it } from 'vitest'
import {
  SHELL_NAV,
  getPathForTab,
  getShellMode,
  getTabFromPath,
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
    expect(getTabFromPath('/unknown')).toBe('logs')
  })

  it('maps tabs to paths', () => {
    expect(getPathForTab('logs')).toBe('/logs')
    expect(getPathForTab('config')).toBe('/config')
    expect(getPathForTab('mock')).toBe('/mock')
    expect(getPathForTab('plugins')).toBe('/plugins')
    expect(getPathForTab('health')).toBe('/health')
    expect(getPathForTab('nope')).toBe('/logs')
  })

  it('treats only traffic (logs) as work mode; all others are config', () => {
    expect(getShellMode('logs')).toBe('work')
    expect(isWorkModeTab('logs')).toBe(true)
    for (const tab of ['config', 'mock', 'plugins', 'health'] as const) {
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
  })
})

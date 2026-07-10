import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCommandSearch } from './use-command-search'
import type { CommandAction } from './types'

const noop = () => undefined

describe('useCommandSearch', () => {
  it('matches commands by keyword aliases', () => {
    const commands: CommandAction[] = [
      {
        id: 'plugins.generate',
        title: 'AI 生成插件',
        section: '插件',
        keywords: ['plugin', 'plugins', 'generate'],
        run: noop,
      },
      {
        id: 'settings.theme',
        title: '主题与缩放设置',
        section: '设置',
        keywords: ['settings', 'theme', 'zoom'],
        run: noop,
      },
    ]

    const { result } = renderHook(() => useCommandSearch(commands, 'plugin'))

    expect(result.current.map((command) => command.id)).toEqual(['plugins.generate'])
  })

  it('keeps disabled matches visible after enabled matches', () => {
    const commands: CommandAction[] = [
      {
        id: 'rules.disabled',
        title: '添加路由规则',
        section: '路由规则',
        keywords: ['rules'],
        disabled: true,
        run: noop,
      },
      {
        id: 'rules.open',
        title: '打开路由规则',
        section: '导航',
        keywords: ['rules'],
        run: noop,
      },
    ]

    const { result } = renderHook(() => useCommandSearch(commands, 'rules'))

    expect(result.current.map((command) => command.id)).toEqual(['rules.open', 'rules.disabled'])
  })
})

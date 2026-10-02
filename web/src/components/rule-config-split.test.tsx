import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuleConfig } from './rule-config'
import { RULE_FILE_LIST_MAX_PX, RULE_FILE_LIST_STORAGE_KEY } from '@/lib/rule-file-split'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function renderRuleConfig() {
  const ruleFiles = [
    { name: 'alpha', enabled: true, ruleCount: 0 },
    { name: 'beta', enabled: true, ruleCount: 1 },
  ]
  render(
    <RuleConfig
      rules={[]}
      setRules={vi.fn()}
      ruleFiles={ruleFiles}
      activeFileName="alpha"
      fetchRuleFiles={vi.fn().mockResolvedValue(ruleFiles)}
      fetchFileContent={vi.fn().mockResolvedValue(undefined)}
      fetchRuleFileRawContent={vi.fn().mockResolvedValue('')}
      saveRuleFileRawContent={vi.fn().mockResolvedValue(true)}
      saveFileContent={vi.fn().mockResolvedValue(true)}
      createRuleFile={vi.fn().mockResolvedValue({ success: true })}
      toggleRuleFile={vi.fn().mockResolvedValue(true)}
      renameRuleFile={vi.fn().mockResolvedValue({ success: true })}
      deleteRuleFile={vi.fn().mockResolvedValue(true)}
      reorderRuleFiles={vi.fn().mockResolvedValue(true)}
    />,
  )
}

describe('RuleConfig file list resize', () => {
  beforeEach(() => {
    localStorage.removeItem(RULE_FILE_LIST_STORAGE_KEY)
    mockMatchMedia(true)
  })

  afterEach(() => {
    localStorage.removeItem(RULE_FILE_LIST_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('starts at the default sidebar width and persists a drag', () => {
    renderRuleConfig()
    const layout = screen.getByTestId('rule-config-layout')
    const list = screen.getByTestId('rule-file-list')
    expect(layout).toHaveAttribute('data-rule-list-width', '252')
    expect(list).toHaveStyle({ width: '252px', flex: '0 0 252px' })

    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1200, top: 0, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => {} }),
    })

    fireEvent.mouseDown(screen.getByTestId('rule-panel-separator'))
    act(() => {
      fireEvent.mouseMove(document, { clientX: 360 })
      fireEvent.mouseUp(document)
    })

    expect(localStorage.getItem(RULE_FILE_LIST_STORAGE_KEY)).toBe('360')
    expect(layout).toHaveAttribute('data-rule-list-width', '360')
    expect(list).toHaveStyle({ width: '360px', flex: '0 0 360px' })
  })

  it('restores a stored width and clamps a drag at the maximum', () => {
    localStorage.setItem(RULE_FILE_LIST_STORAGE_KEY, '300')
    renderRuleConfig()
    const layout = screen.getByTestId('rule-config-layout')
    expect(layout).toHaveAttribute('data-rule-list-width', '300')

    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1200, top: 0, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => {} }),
    })

    fireEvent.mouseDown(screen.getByTestId('rule-panel-separator'))
    act(() => {
      fireEvent.mouseMove(document, { clientX: 900 })
      fireEvent.mouseUp(document)
    })

    expect(layout).toHaveAttribute('data-rule-list-width', String(RULE_FILE_LIST_MAX_PX))
    expect(localStorage.getItem(RULE_FILE_LIST_STORAGE_KEY)).toBe(String(RULE_FILE_LIST_MAX_PX))
  })

  it('does not apply a fixed list width below the wide breakpoint', () => {
    mockMatchMedia(false)
    renderRuleConfig()
    expect(screen.getByTestId('rule-file-list').style.width).toBe('')
  })
})

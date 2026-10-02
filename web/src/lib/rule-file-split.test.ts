import { afterEach, describe, expect, it } from 'vitest'
import {
  RULE_FILE_LIST_DEFAULT_PX,
  RULE_FILE_LIST_MAX_PX,
  RULE_FILE_LIST_MIN_PX,
  RULE_FILE_LIST_STORAGE_KEY,
  clampRuleFileListWidth,
  loadRuleFileListWidth,
  saveRuleFileListWidth,
  widthFromPointer,
} from './rule-file-split'

afterEach(() => {
  localStorage.removeItem(RULE_FILE_LIST_STORAGE_KEY)
})

describe('rule-file list width', () => {
  it('defaults to the old sidebar width and clamps to [220, 480]', () => {
    expect(RULE_FILE_LIST_DEFAULT_PX).toBe(252)
    expect(clampRuleFileListWidth(10)).toBe(RULE_FILE_LIST_MIN_PX)
    expect(clampRuleFileListWidth(900)).toBe(RULE_FILE_LIST_MAX_PX)
    expect(clampRuleFileListWidth(300.4)).toBe(300)
    expect(clampRuleFileListWidth(Number.NaN)).toBe(RULE_FILE_LIST_DEFAULT_PX)
  })

  it('leaves at least the editor minimum inside the container', () => {
    expect(clampRuleFileListWidth(400, 600)).toBe(280)
    expect(clampRuleFileListWidth(100, 1000)).toBe(RULE_FILE_LIST_MIN_PX)
  })

  it('fresh profile defaults to 252px; a stored value wins', () => {
    expect(loadRuleFileListWidth()).toBe(RULE_FILE_LIST_DEFAULT_PX)
    localStorage.setItem(RULE_FILE_LIST_STORAGE_KEY, '360')
    expect(loadRuleFileListWidth()).toBe(360)
    localStorage.setItem(RULE_FILE_LIST_STORAGE_KEY, '900')
    expect(loadRuleFileListWidth()).toBe(RULE_FILE_LIST_MAX_PX)
  })

  it('persists width via localStorage', () => {
    expect(saveRuleFileListWidth(318)).toBe(318)
    expect(localStorage.getItem(RULE_FILE_LIST_STORAGE_KEY)).toBe('318')
    expect(loadRuleFileListWidth()).toBe(318)
  })

  it('maps pointer x to a clamped list width', () => {
    expect(widthFromPointer(360, 0, 1200)).toBe(360)
    expect(widthFromPointer(40, 10, 1200)).toBe(RULE_FILE_LIST_MIN_PX)
    expect(widthFromPointer(900, 0, 1200)).toBe(RULE_FILE_LIST_MAX_PX)
    expect(widthFromPointer(10, 0, 0)).toBe(RULE_FILE_LIST_DEFAULT_PX)
  })
})

/**
 * Rule-file list width. Default matches the previous fixed `w-72` sidebar
 * (18rem at the 14px root).
 */
import { createPaneSplit } from '@/lib/pane-split'

export const ruleFilePaneSplit = createPaneSplit({
  storageKey: 'meddle-rule-file-list-width',
  defaultPx: 252,
  minPx: 220,
  maxPx: 480,
  editorMinPx: 320,
})

export const RULE_FILE_LIST_STORAGE_KEY = ruleFilePaneSplit.storageKey
export const RULE_FILE_LIST_DEFAULT_PX = ruleFilePaneSplit.defaultPx
export const RULE_FILE_LIST_MIN_PX = ruleFilePaneSplit.minPx
export const RULE_FILE_LIST_MAX_PX = ruleFilePaneSplit.maxPx
export const RULE_FILE_LIST_EDITOR_MIN_PX = ruleFilePaneSplit.editorMinPx
export const clampRuleFileListWidth = ruleFilePaneSplit.clamp
export const loadRuleFileListWidth = ruleFilePaneSplit.load
export const saveRuleFileListWidth = ruleFilePaneSplit.save
export const widthFromPointer = ruleFilePaneSplit.widthFromPointer

/**
 * Mock list pane width. Wider than the rule-file list so the table columns stay readable.
 */
import { createPaneSplit } from '@/lib/pane-split'

export const mockPaneSplit = createPaneSplit({
  storageKey: 'meddle-mock-list-width',
  defaultPx: 480,
  minPx: 320,
  maxPx: 640,
  editorMinPx: 360,
})

export const MOCK_LIST_STORAGE_KEY = mockPaneSplit.storageKey
export const MOCK_LIST_DEFAULT_PX = mockPaneSplit.defaultPx
export const MOCK_LIST_MIN_PX = mockPaneSplit.minPx
export const MOCK_LIST_MAX_PX = mockPaneSplit.maxPx
export const MOCK_LIST_EDITOR_MIN_PX = mockPaneSplit.editorMinPx
export const clampMockListWidth = mockPaneSplit.clamp
export const loadMockListWidth = mockPaneSplit.load
export const saveMockListWidth = mockPaneSplit.save
export const mockWidthFromPointer = mockPaneSplit.widthFromPointer

/**
 * Plugin list pane width. The editor on the right is a code or test panel,
 * so the list stays narrower than the mock table.
 */
import { createPaneSplit } from '@/lib/pane-split'

export const pluginPaneSplit = createPaneSplit({
  storageKey: 'meddle-plugin-list-width',
  defaultPx: 360,
  minPx: 280,
  maxPx: 560,
  editorMinPx: 420,
})

export const PLUGIN_LIST_STORAGE_KEY = pluginPaneSplit.storageKey
export const PLUGIN_LIST_DEFAULT_PX = pluginPaneSplit.defaultPx

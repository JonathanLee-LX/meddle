const isEnabled = (value: string | undefined): boolean => {
  if (!value) return false
  return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase())
}

export const FEATURE_FLAGS = {
  ruleGraphView: isEnabled(import.meta.env.VITE_ENABLE_RULE_GRAPH_VIEW),
} as const


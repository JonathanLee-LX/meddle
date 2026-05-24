import { useContext } from 'react'
import { GlobalPanelContext } from './global-panel-context-value'

export function useGlobalPanel() {
  const value = useContext(GlobalPanelContext)
  if (!value) {
    throw new Error('useGlobalPanel must be used inside GlobalPanelProvider')
  }
  return value
}

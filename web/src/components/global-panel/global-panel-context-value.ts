import { createContext } from 'react'
import type { GlobalPanelApi } from './types'

export const GlobalPanelContext = createContext<GlobalPanelApi | null>(null)

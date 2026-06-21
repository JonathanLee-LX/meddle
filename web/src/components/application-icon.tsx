import {
  AppWindow,
  Chrome,
  CircleDot,
  Compass,
  Flame,
  Globe2,
  Hexagon,
  Orbit,
  PanelsTopLeft,
  Search,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProxyRecord } from '@/types'

interface ApplicationIconProps {
  record: Pick<
    ProxyRecord,
    'applicationName' | 'applicationProcess' | 'applicationIdentitySource'
  >
  className?: string
  compact?: boolean
}

interface ApplicationIconStyle {
  icon: LucideIcon
  name: string
  className: string
}

function getApplicationIconStyle(record: ApplicationIconProps['record']): ApplicationIconStyle {
  const identity = `${record.applicationName || ''} ${record.applicationProcess || ''}`.toLowerCase()

  if (identity.includes('chrome') || identity.includes('chromium')) {
    return { icon: Chrome, name: 'chrome', className: 'bg-blue-500/12 text-blue-600 dark:text-blue-400' }
  }
  if (identity.includes('safari')) {
    return { icon: Compass, name: 'safari', className: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' }
  }
  if (identity.includes('edge')) {
    return { icon: Orbit, name: 'edge', className: 'bg-teal-500/12 text-teal-600 dark:text-teal-400' }
  }
  if (identity.includes('firefox')) {
    return { icon: Flame, name: 'firefox', className: 'bg-orange-500/12 text-orange-600 dark:text-orange-400' }
  }
  if (identity.includes('opera')) {
    return { icon: CircleDot, name: 'opera', className: 'bg-red-500/12 text-red-600 dark:text-red-400' }
  }
  if (identity.includes('duckduckgo')) {
    return { icon: Search, name: 'duckduckgo', className: 'bg-orange-500/12 text-orange-600 dark:text-orange-400' }
  }
  if (identity.includes('webview')) {
    return { icon: PanelsTopLeft, name: 'webview', className: 'bg-violet-500/12 text-violet-600 dark:text-violet-400' }
  }
  if (identity.includes('samsung internet')) {
    return { icon: Globe2, name: 'samsung-internet', className: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400' }
  }
  if (identity.includes('curl') || identity.includes('wget') || identity.includes('terminal')) {
    return { icon: Terminal, name: 'terminal', className: 'bg-slate-500/12 text-slate-600 dark:text-slate-300' }
  }
  if (identity.includes('node')) {
    return { icon: Hexagon, name: 'node', className: 'bg-green-500/12 text-green-600 dark:text-green-400' }
  }
  if (record.applicationIdentitySource === 'user-agent') {
    return { icon: Globe2, name: 'browser', className: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400' }
  }
  return { icon: AppWindow, name: 'application', className: 'bg-muted text-muted-foreground' }
}

export function ApplicationIcon({ record, className, compact = false }: ApplicationIconProps) {
  const style = getApplicationIconStyle(record)
  const Icon = style.icon

  return (
    <span
      aria-hidden="true"
      data-application-icon={style.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        compact ? 'size-5' : 'size-6',
        style.className,
        className,
      )}
    >
      <Icon className={compact ? 'size-3.5' : 'size-4'} strokeWidth={2} />
    </span>
  )
}

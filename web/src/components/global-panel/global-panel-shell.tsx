import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ArrowLeft, Command, Loader2, Maximize2, Minimize2, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { CommandAction, GlobalPanelRoute } from './types'
import { useCommandSearch } from './use-command-search'
import { useGlobalPanel } from './use-global-panel'

interface GlobalPanelShellProps {
  commands: CommandAction[]
  renderPanel: (route: GlobalPanelRoute) => React.ReactNode
}

const sizeClassNames: Record<string, string> = {
  command: 'w-[min(720px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-48px))]',
  md: 'w-[min(760px,calc(100vw-32px))] h-[min(720px,calc(100vh-48px))]',
  lg: 'w-[min(1040px,calc(100vw-32px))] h-[min(780px,calc(100vh-48px))]',
  xl: 'w-[min(1240px,calc(100vw-32px))] h-[min(860px,calc(100vh-32px))]',
  fullscreen: 'w-[calc(100vw-32px)] h-[calc(100vh-32px)]',
}

const defaultPanelSizes: Record<string, { width: number; height: number }> = {
  md: { width: 760, height: 720 },
  lg: { width: 1040, height: 780 },
  xl: { width: 1240, height: 860 },
  fullscreen: {
    width: Number.POSITIVE_INFINITY,
    height: Number.POSITIVE_INFINITY
  }
}

function getPanelBounds() {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const maxWidth = Math.max(320, viewportWidth - 32)
  const maxHeight = Math.max(360, viewportHeight - 32)
  return {
    minWidth: Math.min(560, maxWidth),
    minHeight: Math.min(420, maxHeight),
    maxWidth,
    maxHeight
  }
}

function clampPanelSize(size: { width: number; height: number }) {
  const bounds = getPanelBounds()
  return {
    width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, size.width)),
    height: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, size.height))
  }
}

function getDefaultPanelSize(size: string) {
  const bounds = getPanelBounds()
  const defaultSize = defaultPanelSizes[size] || defaultPanelSizes.lg
  if (size === 'fullscreen') {
    return { width: bounds.maxWidth, height: bounds.maxHeight }
  }
  return clampPanelSize(defaultSize)
}

function readStoredPanelSize(routeId: string) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`global-panel-size:${routeId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { width?: number; height?: number }
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null
    return clampPanelSize({ width: parsed.width, height: parsed.height })
  } catch {
    return null
  }
}

function CommandPalette({ commands }: { commands: CommandAction[] }) {
  const panel = useGlobalPanel()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [runningId, setRunningId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const filteredCommands = useCommandSearch(commands, query)

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const activeCommand = filteredCommands[activeIndex]

  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandAction[]>()
    filteredCommands.forEach((command) => {
      if (!groups.has(command.section)) groups.set(command.section, [])
      groups.get(command.section)?.push(command)
    })
    return Array.from(groups.entries())
  }, [filteredCommands])

  const execute = async (command: CommandAction | undefined) => {
    if (!command || command.disabled) return
    if (command.confirm && !window.confirm(command.confirm)) return
    setRunningId(command.id)
    try {
      await command.run()
      if (command.closeOnRun !== false) {
        panel.close()
      }
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => Math.min(index + 1, filteredCommands.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              void execute(activeCommand)
            } else if (event.key === 'Escape' && !query) {
              panel.close()
            }
          }}
          placeholder="搜索操作、页面、设置、规则、Mock 或插件..."
          className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        <Badge variant="outline" className="hidden shrink-0 text-[11px] font-normal sm:inline-flex">
          ⌘K
        </Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {filteredCommands.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <Command className="h-8 w-8 opacity-50" />
            <div className="text-sm">没有找到匹配的操作</div>
          </div>
        ) : (
          <div className="space-y-4 p-3">
            {groupedCommands.map(([section, sectionCommands]) => (
              <div key={section} className="space-y-1">
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {section}
                </div>
                {sectionCommands.map((command) => {
                  const commandIndex = filteredCommands.findIndex((item) => item.id === command.id)
                  const Icon = command.icon
                  const selected = commandIndex === activeIndex
                  const running = runningId === command.id
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors',
                        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
                        command.disabled && 'cursor-not-allowed opacity-50',
                        command.danger && !command.disabled && 'text-destructive',
                      )}
                      onMouseEnter={() => setActiveIndex(commandIndex)}
                      onClick={() => void execute(command)}
                      disabled={running}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background">
                        {running ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : Icon ? (
                          <Icon className="h-4 w-4" />
                        ) : (
                          <Command className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{command.title}</div>
                        {(command.description || command.disabledReason) && (
                          <div className="truncate text-xs text-muted-foreground">
                            {command.disabled ? command.disabledReason || command.description : command.description}
                          </div>
                        )}
                      </div>
                      {command.shortcut && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                          {command.shortcut}
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export function GlobalPanelShell({ commands, renderPanel }: GlobalPanelShellProps) {
  const panel = useGlobalPanel()
  const route = panel.currentRoute
  const size = route?.size || 'command'
  const routeId = route?.id
  const routeSize = route?.size
  const [panelSize, setPanelSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const previousPanelSizeRef = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!routeId) {
        setPanelSize(null)
        setFullscreen(false)
        return
      }

      const initialSize = readStoredPanelSize(routeId) || getDefaultPanelSize(routeSize || 'lg')
      setPanelSize(initialSize)
      setFullscreen(routeSize === 'fullscreen')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [routeId, routeSize])

  useEffect(() => {
    if (!routeId) return

    const handleResize = () => {
      setPanelSize((current) => (current ? clampPanelSize(current) : current))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [routeId])

  const persistPanelSize = (nextSize: { width: number; height: number }) => {
    if (!route || fullscreen || typeof window === 'undefined') return
    window.localStorage.setItem(`global-panel-size:${route.id}`, JSON.stringify(nextSize))
  }

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!route || !panelSize || fullscreen) return
    event.preventDefault()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startSize = panelSize
    const target = event.currentTarget
    target.setPointerCapture(pointerId)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextSize = clampPanelSize({
        width: startSize.width + (moveEvent.clientX - startX) * 2,
        height: startSize.height + (moveEvent.clientY - startY)
      })
      setPanelSize(nextSize)
    }

    const handlePointerUp = () => {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId)
      }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      setPanelSize((current) => {
        if (current) persistPanelSize(current)
        return current
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const toggleFullscreen = () => {
    if (!route || !panelSize) return

    if (fullscreen) {
      const restoredSize = previousPanelSizeRef.current || readStoredPanelSize(route.id) || getDefaultPanelSize(route.size || 'lg')
      setPanelSize(clampPanelSize(restoredSize))
      setFullscreen(false)
      return
    }

    previousPanelSizeRef.current = panelSize
    setPanelSize(getDefaultPanelSize('fullscreen'))
    setFullscreen(true)
  }

  const panelStyle = route && panelSize ? { width: `${panelSize.width}px`, height: `${panelSize.height}px` } : undefined

  return (
    <DialogPrimitive.Root
      open={panel.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) panel.close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-md data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          style={panelStyle}
          className={cn(
            'fixed left-1/2 top-4 z-[81] flex -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            !route && sizeClassNames[size],
          )}
        >
          {route ? (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={panel.stack.length > 1 ? panel.back : panel.openCommand}
                  title={panel.stack.length > 1 ? '返回上一级' : '返回命令面板'}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="truncate text-sm font-semibold">
                    {route.title}
                  </DialogPrimitive.Title>
                  {route.description && (
                    <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                      {route.description}
                    </DialogPrimitive.Description>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={toggleFullscreen}
                  title={fullscreen ? '还原尺寸' : '最大化'}
                >
                  {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={panel.close} title="关闭">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {renderPanel(route)}
              </div>
              {!fullscreen && (
                <button
                  type="button"
                  aria-label="调整面板尺寸"
                  title="拖拽调整面板尺寸"
                  className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize rounded-tl-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  onPointerDown={startResize}
                >
                  <span className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b border-r border-current" />
                </button>
              )}
            </>
          ) : (
            <>
              <DialogPrimitive.Title className="sr-only">全局操作面板</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                搜索并执行 Easy Proxy 的页面、设置和功能操作。
              </DialogPrimitive.Description>
              <CommandPalette commands={commands} />
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

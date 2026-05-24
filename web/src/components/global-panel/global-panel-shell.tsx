import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ArrowLeft, Command, Loader2, Search, X } from 'lucide-react'
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
  md: 'w-[min(760px,calc(100vw-32px))] h-[min(760px,calc(100vh-48px))]',
  lg: 'w-[min(940px,calc(100vw-32px))] h-[min(820px,calc(100vh-48px))]',
  xl: 'w-[min(1120px,calc(100vw-32px))] h-[min(860px,calc(100vh-32px))]',
  fullscreen: 'w-[calc(100vw-32px)] h-[calc(100vh-32px)]',
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

  return (
    <DialogPrimitive.Root open={panel.open} onOpenChange={(nextOpen) => {
      if (!nextOpen) panel.close()
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/45 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-8 z-[81] flex -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            sizeClassNames[size],
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
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={panel.close} title="关闭">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {renderPanel(route)}
              </div>
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

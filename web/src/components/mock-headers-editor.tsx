import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MonacoEditor } from './monaco-editor'

export interface HeaderEntry {
  key: string
  value: string
}

interface HeaderRow extends HeaderEntry {
  id: string
}

type HeaderView = 'list' | 'code'

function headerValueToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Parse response-header JSON into ordered entries. Invalid text is reported and not applied. */
export function parseHeaderObject(text: string): { entries: HeaderEntry[]; error: string | null } {
  if (!text.trim()) return { entries: [], error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { entries: [], error: '响应头 JSON 无法解析' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { entries: [], error: '响应头必须是 JSON 对象' }
  }
  return {
    entries: Object.entries(parsed).map(([key, value]) => ({
      key,
      value: headerValueToString(value),
    })),
    error: null,
  }
}

/** Skip blank names. Later rows win when names collide, matching JSON objects. */
export function serializeHeaderEntries(entries: HeaderEntry[]): string {
  const headers: Record<string, string> = {}
  for (const entry of entries) {
    const key = entry.key.trim()
    if (!key) continue
    headers[key] = entry.value
  }
  return JSON.stringify(headers, null, 2)
}

interface MockHeadersEditorProps {
  value: string
  onChange: (value: string) => void
}

export function MockHeadersEditor({ value, onChange }: MockHeadersEditorProps) {
  const rowSeq = useRef(0)
  const createRow = (entry?: HeaderEntry): HeaderRow => {
    rowSeq.current += 1
    return { id: `header-row-${rowSeq.current}`, key: entry?.key ?? '', value: entry?.value ?? '' }
  }

  const initial = parseHeaderObject(value)
  const [view, setView] = useState<HeaderView>('list')
  const [rows, setRows] = useState<HeaderRow[]>(() => initial.entries.map((entry) => createRow(entry)))
  const [parseError, setParseError] = useState<string | null>(initial.error)
  const [editorHeight, setEditorHeight] = useState(180)

  const handleEditorResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = editorHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setEditorHeight(Math.max(120, startHeight + moveEvent.clientY - startY))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [editorHeight])

  const commitRows = (next: HeaderRow[]) => {
    setRows(next)
    setParseError(null)
    onChange(serializeHeaderEntries(next))
  }

  const switchView = (next: string) => {
    if (next !== 'list' && next !== 'code') return
    if (next === 'list') {
      const parsed = parseHeaderObject(value)
      setParseError(parsed.error)
      if (!parsed.error) setRows(parsed.entries.map((entry) => createRow(entry)))
    }
    setView(next)
  }

  return (
    <div className="app-field-group">
      <Tabs value={view} onValueChange={switchView}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>响应头</Label>
          <TabsList aria-label="响应头编辑视图">
            <TabsTrigger value="list" data-testid="mock-headers-view-list">列表</TabsTrigger>
            <TabsTrigger value="code" data-testid="mock-headers-view-code">代码</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {view === 'list' ? (
        parseError ? (
          <p className="text-xs text-red-600 dark:text-red-400" data-testid="mock-headers-parse-error">
            {parseError}。请在代码视图中修正。
          </p>
        ) : (
          <div className="flex flex-col gap-2" data-testid="mock-headers-list">
            {rows.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(event) => {
                    const next = rows.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item))
                    commitRows(next)
                  }}
                  placeholder="名称"
                  aria-label={`响应头名称 ${index + 1}`}
                  className="font-mono"
                />
                <Input
                  value={row.value}
                  onChange={(event) => {
                    const next = rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item))
                    commitRows(next)
                  }}
                  placeholder="值"
                  aria-label={`响应头值 ${index + 1}`}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除响应头 ${index + 1}`}
                  onClick={() => commitRows(rows.filter((item) => item.id !== row.id))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => commitRows([...rows, createRow()])}
            >
              <Plus data-icon="inline-start" />
              添加
            </Button>
          </div>
        )
      ) : (
        <div className="group relative" style={{ height: `${editorHeight}px` }} data-testid="mock-headers-code-frame">
          <MonacoEditor
            value={value}
            onChange={onChange}
            language="json"
            height="flex"
            className="mock-headers-code"
            placeholder='{"Content-Type":"application/json"}'
          />
          <div
            data-testid="mock-headers-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="调整响应头编辑器高度"
            aria-valuenow={editorHeight}
            className="absolute bottom-0 left-0 right-0 flex h-4 cursor-ns-resize items-center justify-center bg-gradient-to-t from-border/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
            onMouseDown={handleEditorResize}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  )
}

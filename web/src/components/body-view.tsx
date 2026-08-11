import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Check } from 'lucide-react'
import { highlightCode, detectLanguage } from '@/lib/syntax-highlight'
import { copyText } from '@/utils/clipboard'
import { toast } from '@/components/ui/toast'
import { formatHeadersText } from '@/utils/headers'

const COPIED_FEEDBACK_MS = 2000

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleCopy() {
    try {
      await copyText(text)
      setCopied(true)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      toast.success(`已复制${label}`)
    } catch {
      toast.error(`复制${label}失败，请手动选择复制`)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
      aria-label={copied ? `复制${label}成功` : `复制${label}`}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-3 w-3 mr-1 text-green-600" /> : <Copy className="h-3 w-3 mr-1" />}
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

interface CopyableJsonBodyProps {
  body: string
}

/**
 * Body view with:
 *  - tab switch 「源数据 / 格式化」 for JSON bodies
 *  - copy button (copies the RAW body)
 * Non-JSON bodies render as before (highlighted plain text, no tabs).
 */
export function CopyableJsonBody({ body }: CopyableJsonBodyProps) {
  const [mode, setMode] = useState<'source' | 'formatted'>('source')
  const isJson = useMemo(() => detectLanguage(body || '') === 'json', [body])
  const prettyBody = useMemo(() => {
    if (!isJson) return body
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return body
    }
  }, [body, isJson])
  const highlighted = useMemo(
    () => highlightCode(mode === 'formatted' ? prettyBody : body, isJson ? 'json' : undefined),
    [body, prettyBody, mode, isJson],
  )

  if (!body) {
    return <p className="text-sm text-muted-foreground py-2">无内容</p>
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {isJson ? (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'source' | 'formatted')} className="w-fit">
            <TabsList className="h-6 px-1">
              <TabsTrigger value="source" className="h-6 px-2 text-[11px]">源数据</TabsTrigger>
              <TabsTrigger value="formatted" className="h-6 px-2 text-[11px]">格式化</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <span />
        )}
        <CopyButton text={body} label="Body" />
      </div>
      <div className="font-mono text-xs bg-muted/30 rounded p-2 overflow-x-auto">
        <pre className="whitespace-pre">{highlighted}</pre>
      </div>
    </div>
  )
}

interface CopyableHeadersProps {
  headers: Record<string, string>
}

/** Headers view with a copy button (serialized "key: value" lines). */
export function CopyableHeaders({ headers }: CopyableHeadersProps) {
  const entries = Object.entries(headers || {})

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">无头部信息</p>
  }

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <CopyButton text={formatHeadersText(headers)} label="Headers" />
      </div>
      <div className="font-mono text-xs space-y-0.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-2 py-0.5 hover:bg-muted/50 px-1 rounded">
            <span className="text-purple-600 shrink-0 font-semibold">{key}:</span>
            <span className="text-foreground/80 break-all">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

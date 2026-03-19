import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ArrowRight, FileText, Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RuleItem } from '@/types'
import { rulesToEprc } from '@/utils/eprc-parser'

interface RoutePreviewProps {
  rules: RuleItem[]
  activeFileName: string | null
}

interface RoutePreviewResponse {
  status?: string
  inputUrl: string
  matched: boolean
  resolvedUrl: string
  matchedRule?: {
    pattern: string
    target: string
    kind: 'empty' | 'file' | 'absolute-url' | 'host'
  }
  notes: string[]
  error?: string
}

export function RoutePreview({ rules, activeFileName }: RoutePreviewProps) {
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RoutePreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rulesText = useMemo(() => rulesToEprc(rules), [rules])

  const handlePreview = useCallback(async () => {
    const trimmed = inputUrl.trim()
    if (!trimmed) {
      setError('请输入待预览的 URL')
      setResult(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rules/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, rulesText }),
      })
      const data = await res.json() as RoutePreviewResponse
      if (!res.ok) {
        throw new Error(data?.error || '预览失败')
      }
      setResult(data)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : '预览失败')
    } finally {
      setLoading(false)
    }
  }, [inputUrl, rulesText])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      void handlePreview()
    }
  }, [handlePreview])

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">URL 预览</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            输入一个请求 URL，后端会用当前编辑中的规则直接计算真实转发地址。
          </p>
        </div>
        {activeFileName && (
          <Badge variant="outline" className="text-[11px] font-normal">
            <FileText className="h-3 w-3 mr-1" />
            {activeFileName}
          </Badge>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={inputUrl}
          onChange={(event) => setInputUrl(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://solution.wps.cn/docs/price/detail.html?source=navbar"
          className="h-9 font-mono text-xs"
        />
        <Button onClick={handlePreview} disabled={loading} className="h-9 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '预览'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={result.matched ? 'bg-green-100 text-green-800 border-green-200' : 'bg-blue-100 text-blue-800 border-blue-200'}>
              {result.matched ? '已命中规则' : '未命中规则'}
            </Badge>
            {result.matchedRule && (
              <Badge variant="outline" className="text-[11px] font-normal">
                {result.matchedRule.kind}
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">真实 URL</div>
            <div className="rounded-md border bg-background px-3 py-2 font-mono text-xs break-all">
              {result.resolvedUrl}
            </div>
          </div>

          {result.matchedRule && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">命中规则</div>
              <div className="rounded-md border bg-background px-3 py-2 font-mono text-xs break-all">
                {result.matchedRule.pattern}
                <span className="text-muted-foreground"> → </span>
                {result.matchedRule.target}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">说明</div>
            <div className="space-y-1 rounded-md border bg-background px-3 py-2 text-xs">
              {result.notes.length > 0 ? (
                result.notes.map((note) => (
                  <div key={note} className="flex items-center gap-2">
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span>{note}</span>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">无</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

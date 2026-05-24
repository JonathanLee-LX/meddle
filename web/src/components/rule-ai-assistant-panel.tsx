import { useCallback, useState } from 'react'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { generateRulesWithAI, mergeRulesWithAI } from '@/lib/ai-rule-merge'
import { parseEprcRules, rulesToEprc } from '@/utils/eprc-parser'
import type { RuleFile, RuleItem } from '@/types'

interface RuleAiAssistantPanelProps {
  rules: RuleItem[]
  setRules: React.Dispatch<React.SetStateAction<RuleItem[]>>
  ruleFiles: RuleFile[]
  activeFileName: string | null
  fetchRuleFileRawContent: (name: string) => Promise<string>
}

export function RuleAiAssistantPanel({
  rules,
  setRules,
  ruleFiles,
  activeFileName,
  fetchRuleFileRawContent,
}: RuleAiAssistantPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [merging, setMerging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadContextFiles = useCallback(async () => {
    return Promise.all(
      ruleFiles
        .filter((file) => file.enabled && file.name !== activeFileName)
        .map(async (file) => ({
          name: file.name,
          content: await fetchRuleFileRawContent(file.name),
        })),
    )
  }, [activeFileName, fetchRuleFileRawContent, ruleFiles])

  const handleGenerate = useCallback(async () => {
    if (!activeFileName) return
    setGenerating(true)
    setMessage(null)
    setError(null)

    try {
      const generatedText = await generateRulesWithAI(
        prompt,
        rulesToEprc(rules),
        await loadContextFiles(),
      )
      const generatedRules = parseEprcRules(generatedText)

      if (generatedRules.length === 0) {
        throw new Error('AI 没有生成可用规则，请调整提示词后重试')
      }

      setRules((prev) => [...generatedRules, ...prev])
      setMessage(`AI 已生成 ${generatedRules.length} 条规则，并追加到当前编辑区顶部。当前未自动保存。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 生成规则失败')
    } finally {
      setGenerating(false)
    }
  }, [activeFileName, loadContextFiles, prompt, rules, setRules])

  const handleMerge = useCallback(async () => {
    if (!activeFileName || rules.length === 0) return
    setMerging(true)
    setMessage(null)
    setError(null)

    try {
      const mergedText = await mergeRulesWithAI(
        rulesToEprc(rules),
        await loadContextFiles(),
        prompt,
      )
      const mergedRules = parseEprcRules(mergedText)

      if (rules.length > 0 && mergedRules.length === 0) {
        throw new Error('AI 返回的规则为空，请调整提示词或检查模型输出')
      }

      setRules(mergedRules)
      setMessage(`AI 已完成规则合并：${rules.length} 条 -> ${mergedRules.length} 条。当前仅替换编辑区，未自动保存。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 合并失败')
    } finally {
      setMerging(false)
    }
  }, [activeFileName, loadContextFiles, prompt, rules, setRules])

  const busy = generating || merging

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border bg-muted/40 px-2 py-1">支持通配符合并</span>
          <span className="rounded-full border bg-muted/40 px-2 py-1">可带额外优化提示词</span>
          <span className="rounded-full border bg-muted/40 px-2 py-1">结果写回当前编辑区</span>
        </div>

        <Badge variant="outline" className="border-primary/20 bg-background/70 text-xs font-normal">
          {activeFileName ? `当前文件：${activeFileName}` : '未选择规则文件'}
        </Badge>

        {message && (
          <Alert className="border-green-200 bg-green-50/80 dark:border-green-900 dark:bg-green-950/20">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">AI 规则提示词</div>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：将 wps.cn 域名都转发到 120.92.124.158 IP；或：优先使用通配符合并同一业务域名，不要把 openapi 相关域名并到 *.wps.cn。"
            className="min-h-[180px] bg-background"
            disabled={busy}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          这段提示词同时用于“AI 生成规则”和“AI 合并规则”。生成规则时必填；合并规则时可留空。
        </p>
      </div>

      <div className="border-t p-4">
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!activeFileName || !prompt.trim() || busy}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {generating ? 'AI 生成中...' : 'AI 生成规则'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMerge}
            disabled={!activeFileName || rules.length === 0 || busy}
          >
            {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {merging ? 'AI 合并中...' : 'AI 合并规则'}
          </Button>
        </div>
      </div>
    </div>
  )
}

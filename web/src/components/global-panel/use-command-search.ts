import { useMemo } from 'react'
import type { CommandAction } from './types'

interface ScoredCommand {
  command: CommandAction
  score: number
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = normalize(query)
  const t = normalize(target)
  if (!q) return 1
  if (!t) return 0
  if (t === q) return 120
  if (t.startsWith(q)) return 100 - Math.min(t.length - q.length, 30)
  if (t.includes(q)) return 80 - Math.min(t.indexOf(q), 30)

  let qi = 0
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (q[qi] === t[ti]) {
      qi += 1
      score += 4
    }
  }
  return qi === q.length ? score : 0
}

function scoreCommand(query: string, command: CommandAction): number {
  const haystacks = [
    command.title,
    command.description || '',
    command.section,
    ...(command.keywords || []),
  ]
  return Math.max(...haystacks.map((value) => fuzzyScore(query, value)))
}

export function useCommandSearch(commands: CommandAction[], query: string): CommandAction[] {
  return useMemo(() => {
    const scored: ScoredCommand[] = commands
      .map((command) => ({ command, score: scoreCommand(query, command) }))
      .filter((item) => item.score > 0)

    scored.sort((a, b) => {
      if (a.command.disabled !== b.command.disabled) return a.command.disabled ? 1 : -1
      if (b.score !== a.score) return b.score - a.score
      return a.command.title.localeCompare(b.command.title, 'zh-Hans-CN')
    })

    return scored.map((item) => item.command)
  }, [commands, query])
}

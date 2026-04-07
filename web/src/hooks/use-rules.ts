import { useState, useCallback } from 'react'
import type { RuleItem, RuleFile } from '@/types'
import { parseEprcRules, rulesToEprc } from '@/utils/eprc-parser'

export function useRules() {
  const [rules, setRules] = useState<RuleItem[]>([])
  const [ruleFiles, setRuleFiles] = useState<RuleFile[]>([])
  const [activeFileName, setActiveFileName] = useState<string | null>(null)

  const fetchRuleFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/rule-files')
      const data = await res.json()
      const files: RuleFile[] = Array.isArray(data) ? data : []
      setRuleFiles(files)
      return files
    } catch (err) {
      console.error('Failed to fetch rule files:', err)
      return []
    }
  }, [])

  const fetchFileContent = useCallback(async (name: string) => {
    try {
      const text = await fetchRuleFileRawContent(name)
      setRules(parseEprcRules(text))
      setActiveFileName(name)
    } catch (err) {
      console.error('Failed to fetch file content:', err)
    }
  }, [])

  const fetchRuleFileRawContent = useCallback(async (name: string): Promise<string> => {
    const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}/content`)
    return res.text()
  }, [])

  const saveFileContent = useCallback(async (name: string, items: RuleItem[]): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: rulesToEprc(items) }),
      })
      const data = await res.json()
      return data.status === 'success'
    } catch (err) {
      console.error('Failed to save file content:', err)
      return false
    }
  }, [])

  const createRuleFile = useCallback(async (name: string, content = ''): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/rule-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, enabled: true }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        await fetchRuleFiles()
        return { success: true }
      }
      return { success: false, error: data.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }, [fetchRuleFiles])

  const toggleRuleFile = useCallback(async (name: string, enabled: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        await fetchRuleFiles()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to toggle rule file:', err)
      return false
    }
  }, [fetchRuleFiles])

  const deleteRuleFile = useCallback(async (name: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') {
        if (activeFileName === name) {
          setActiveFileName(null)
          setRules([])
        }
        await fetchRuleFiles()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to delete rule file:', err)
      return false
    }
  }, [fetchRuleFiles, activeFileName])

  return {
    rules,
    setRules,
    ruleFiles,
    activeFileName,
    fetchRuleFiles,
    fetchFileContent,
    fetchRuleFileRawContent,
    saveFileContent,
    createRuleFile,
    toggleRuleFile,
    deleteRuleFile,
  }
}

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

  const fetchRuleFileRawContent = useCallback(async (name: string): Promise<string> => {
    const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}/content`)
    return res.text()
  }, [])

  const fetchFileContent = useCallback(async (name: string) => {
    try {
      const text = await fetchRuleFileRawContent(name)
      setRules(parseEprcRules(text))
      setActiveFileName(name)
    } catch (err) {
      console.error('Failed to fetch file content:', err)
    }
  }, [fetchRuleFileRawContent])

  const saveRuleFileRawContent = useCallback(async (name: string, content: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      return data.status === 'success'
    } catch (err) {
      console.error('Failed to save file content:', err)
      return false
    }
  }, [])

  const saveFileContent = useCallback(async (name: string, items: RuleItem[]): Promise<boolean> => {
    return saveRuleFileRawContent(name, rulesToEprc(items))
  }, [saveRuleFileRawContent])

  const createRuleFile = useCallback(async (name: string, content = ''): Promise<{ success: boolean; error?: string }> => {
    const trimmedName = name.trim()
    try {
      const res = await fetch('/api/rule-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, content, enabled: true }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        await fetchRuleFiles()
        return { success: true }
      }
      return { success: false, error: data.error }
    } catch (err) {
      // The server may finish creating the file just before a transient
      // connection drop. Reconcile with the authoritative file list so the UI
      // does not report a false failure for an operation that already landed.
      const files = await fetchRuleFiles()
      if (files.some((file) => file.name === trimmedName)) {
        return { success: true }
      }
      return { success: false, error: err instanceof Error ? err.message : '创建规则文件失败' }
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

  const renameRuleFile = useCallback(async (name: string, newName: string): Promise<{ success: boolean; name?: string; error?: string }> => {
    const trimmedName = newName.trim()
    if (!trimmedName) return { success: false, error: '规则文件名称不能为空' }

    try {
      const res = await fetch(`/api/rule-files/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: trimmedName }),
      })
      const data = await res.json()
      if (data.status !== 'success') {
        return { success: false, error: data.error || '重命名失败' }
      }

      const resolvedName = typeof data.name === 'string' ? data.name : trimmedName
      if (activeFileName === name) {
        setActiveFileName(resolvedName)
      }
      await fetchRuleFiles()
      return { success: true, name: resolvedName }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '重命名失败' }
    }
  }, [activeFileName, fetchRuleFiles])

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
    saveRuleFileRawContent,
    saveFileContent,
    createRuleFile,
    toggleRuleFile,
    renameRuleFile,
    deleteRuleFile,
  }
}

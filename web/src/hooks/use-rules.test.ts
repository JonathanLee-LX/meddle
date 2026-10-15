import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRules } from './use-rules'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRules createRuleFile', () => {
  it('reconciles a transient create response failure with the server file list', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { name: '新规则', enabled: true, ruleCount: 0, excludeCount: 0 },
      ]), {
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    let createResult: Awaited<ReturnType<typeof result.current.createRuleFile>> | undefined

    await act(async () => {
      createResult = await result.current.createRuleFile('新规则')
    })

    expect(createResult).toEqual({ success: true })
    expect(result.current.ruleFiles).toHaveLength(1)
  })

  it('returns the network error when the file was not created', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('[]', {
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    let createResult: Awaited<ReturnType<typeof result.current.createRuleFile>> | undefined

    await act(async () => {
      createResult = await result.current.createRuleFile('未创建')
    })

    expect(createResult).toEqual({ success: false, error: 'Failed to fetch' })
  })
})


describe('useRules reorderRuleFiles', () => {
  it('persists tab order via PUT /api/rule-files/order and refreshes the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', order: ['b', 'a'] }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { name: 'b', enabled: true, ruleCount: 1 },
        { name: 'a', enabled: false, ruleCount: 1 },
      ]), {
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())

    await act(async () => {
      // seed local state
      result.current.ruleFiles.length
    })

    // Manually seed by calling fetchRuleFiles first path through reorder's optimistic path
    // Start with empty then reorder with names that will optimistic-skip if empty
    let ok = false
    await act(async () => {
      ok = await result.current.reorderRuleFiles(['b', 'a'])
    })

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/rule-files/order', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ order: ['b', 'a'] }),
    }))
    expect(result.current.ruleFiles.map((file) => file.name)).toEqual(['b', 'a'])
  })
})

// Issue #145: a table-view save keeps comments, blank lines and other rules' exclusions.
describe('useRules saveFileContent', () => {
  it('writes back only the edited line of the loaded file', async () => {
    const original = '# 联调\napi.example.com !/api http://localhost:5173\n\nedit.example.com !/keep 127.0.0.1:3000\n'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(original))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    await act(async () => {
      await result.current.fetchFileContent('dev')
    })
    const edited = result.current.rules.map((r) => (r.rule === 'edit.example.com' ? { ...r, target: '127.0.0.1:3001' } : r))
    let ok = false
    await act(async () => {
      ok = await result.current.saveFileContent('dev', edited)
    })

    expect(ok).toBe(true)
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body).content).toBe('# 联调\napi.example.com !/api http://localhost:5173\n\nedit.example.com !/keep 127.0.0.1:3001\n')
  })
})

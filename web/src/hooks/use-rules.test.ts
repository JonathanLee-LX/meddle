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

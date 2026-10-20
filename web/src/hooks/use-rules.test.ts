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

describe('useRules — BOM and read-only rulesets (issue #145)', () => {
  const bom = '\uFEFF'
  const original = `${bom}first.example.com !/f 127.0.0.1:1000\n# c\nedit.example.com !/keep 127.0.0.1:3000\n`
  // Raw response bytes; TextEncoder always writes U+FEFF as EF BB BF.
  const bytes = (text: string) => new TextEncoder().encode(text)

  it('reads the raw content with its BOM and saves it back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(bytes(original), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    await act(async () => {
      await result.current.fetchFileContent('dev')
    })
    expect(result.current.rules[0].rule).toBe('first.example.com')
    const edited = result.current.rules.map((r, i) => (i === 0 ? { ...r, target: '127.0.0.1:1001' } : r))
    await act(async () => {
      await result.current.saveFileContent('dev', edited)
    })
    const [, init] = fetchMock.mock.calls[1]
    // Compare bytes, not strings: EF BB BF first, then the rest as expected.
    const sent = new TextEncoder().encode(JSON.parse(init.body).content)
    const rest = new TextEncoder().encode(original.slice(1).replace('127.0.0.1:1000', '127.0.0.1:1001'))
    expect(Array.from(sent.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(Array.from(sent.slice(3))).toEqual(Array.from(rest))
  })

  it('a table save to a read-only ruleset (423 RULESET_READONLY) reports failure and keeps the last saved text', async () => {
    const locked = new Response(JSON.stringify({ code: 'RULESET_READONLY', error: '该规则集已设为只读，只能在 Meddle 界面中解锁', ruleFile: 'dev' }), {
      status: 423,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(bytes(original)))
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    await act(async () => {
      await result.current.fetchFileContent('dev')
    })
    const rules = result.current.rules
    const removed = rules.filter((r) => r.rule !== 'edit.example.com')
    let ok = true
    await act(async () => {
      ok = await result.current.saveFileContent('dev', removed)
    })
    expect(ok).toBe(false)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/rule-files/dev/content')
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT')

    // The refused write did not become the base for the next save.
    await act(async () => {
      await result.current.saveFileContent('dev', rules)
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).content).toBe(original)
  })
})

describe('useRules — a rule that would turn into a comment (issue #145)', () => {
  it('saveFileContent rejects with the message and sends no write', async () => {
    const text = 'a.example.com #tag.example.com 127.0.0.1:1\n'
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(text))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    await act(async () => {
      await result.current.fetchFileContent('dev')
    })
    const removed = result.current.rules.filter((r) => r.rule !== 'a.example.com')
    await expect(result.current.saveFileContent('dev', removed)).rejects.toThrow('该行剩余的 pattern 以 // 或 # 开头，拆开后会被当成注释，请用文本编辑器手动修改')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['#foo.com', '//foo.com'])('saveFileContent rejects a NEW rule %s with the new-rule message and sends no write', async (pattern) => {
    const text = '\uFEFFa.example.com 127.0.0.1:1\r\n'
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(text))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRules())
    await act(async () => {
      await result.current.fetchFileContent('dev')
    })
    const next = [...result.current.rules, { enabled: true, rule: pattern, target: '127.0.0.1:9', exclusions: [] }]
    await expect(result.current.saveFileContent('dev', next)).rejects.toThrow('规则不能以 // 或 # 开头，否则会被当成禁用行或注释。要写注释或禁用规则，请用文本编辑器。')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

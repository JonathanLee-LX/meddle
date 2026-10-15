import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putRuleFileReadonly, resetUiTokenCache } from './ui-token'

/** Issue #137: the UI sends the page token with lock / unlock requests. */

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('putRuleFileReadonly', () => {
  let meta: HTMLMetaElement

  beforeEach(() => {
    resetUiTokenCache()
    meta = document.createElement('meta')
    meta.name = 'meddle-ui-token'
    meta.content = 'page-token'
    document.head.appendChild(meta)
  })

  afterEach(() => {
    meta.remove()
    vi.unstubAllGlobals()
  })

  it('sends the token from the page meta tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'success', name: 'dev', readonly: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(putRuleFileReadonly('dev 规则', true)).resolves.toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/rule-files/dev%20%E8%A7%84%E5%88%99/readonly')
    expect(init.method).toBe('PUT')
    expect(init.headers['X-Meddle-UI-Token']).toBe('page-token')
    expect(JSON.parse(init.body)).toEqual({ readonly: true })
  })

  it('refreshes a stale token (server restarted) from the same-origin bootstrap and retries once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(403, { code: 'UI_TOKEN_INVALID', error: '界面令牌无效' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'success' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(putRuleFileReadonly('dev', false)).resolves.toEqual({ success: true })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ui-token')
    expect(fetchMock.mock.calls[2][1].headers['X-Meddle-UI-Token']).toBe('fresh-token')
  })

  it('reports the server error without retrying other failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: 'UI_ORIGIN_REQUIRED', error: '只能在 Meddle 界面中加锁或解锁' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(putRuleFileReadonly('dev', true)).resolves.toEqual({ success: false, error: '只能在 Meddle 界面中加锁或解锁' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

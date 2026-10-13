import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCachedSettings, updateSettings } from './settings-store'

/** Issue #121: a save only sends the changed fields, so a stale tab cannot revert others. */
describe('updateSettings (issue #121)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes only the changed fields and caches the merged server result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ status: 'success', settings: { theme: 'dark', mocksFilePath: '/from/other/tab.json' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      // a full GET would return stale data; it must not be needed
      return new Response(JSON.stringify({ theme: 'light', mocksFilePath: '/stale.json' }), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await updateSettings({ theme: 'dark' })

    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toBe('/api/settings')
    expect(writes[0][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ theme: 'dark' })
    expect(getCachedSettings()).toMatchObject({ theme: 'dark', mocksFilePath: '/from/other/tab.json' })
  })

  it('throws when the server rejects the save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(updateSettings({ theme: 'dark' })).rejects.toThrow('保存设置失败')
  })
})

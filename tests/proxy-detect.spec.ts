import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Issue #85: stale mcp-proxy-url.json must not stick forever —
 * resolveLiveProxyUrl falls through to the default port when the file port is dead.
 */

describe('proxy-detect resolveLiveProxyUrl (issue #85)', () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'meddle-probe-'))
    prevHome = process.env.MEDDLE_HOME
    process.env.MEDDLE_HOME = home
    delete process.env.MEDDLE_SESSION_PORT
    const pd = require('../bin/lib/proxy-detect')
    pd.__resetResolvedProxyUrlForTest()
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MEDDLE_HOME
    else process.env.MEDDLE_HOME = prevHome
    delete process.env.MEDDLE_SESSION_PORT
    try { rmSync(home, { recursive: true, force: true }) } catch (_) {}
    const pd = require('../bin/lib/proxy-detect')
    pd.__resetResolvedProxyUrlForTest()
  })

  it('falls back to default when mcp-proxy-url.json points at a dead port', async () => {
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:1',
    }))
    const pd = require('../bin/lib/proxy-detect')
    pd.__resetResolvedProxyUrlForTest()

    const probed: string[] = []
    const resolved = await pd.resolveLiveProxyUrl(1500, async (u: string) => {
      probed.push(u)
      return u !== 'http://127.0.0.1:1'
    })
    expect(probed[0]).toBe('http://127.0.0.1:1')
    expect(resolved).toBe(pd.DEFAULT_PROXY_BASE)
    expect(pd.getProxyUrl()).toBe(pd.DEFAULT_PROXY_BASE)
  })

  it('isProxyRunning returns false when every candidate is dead', async () => {
    // Pin session to a dead port so a live process on default 8989 cannot leak in.
    process.env.MEDDLE_SESSION_PORT = '1'
    const pd = require('../bin/lib/proxy-detect')
    pd.__resetResolvedProxyUrlForTest()
    const running = await pd.isProxyRunning(300)
    expect(running).toBe(false)
  })

  it('getCandidateProxyUrls lists file URL before default', () => {
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:9991/',
    }))
    const pd = require('../bin/lib/proxy-detect')
    const urls = pd.getCandidateProxyUrls()
    expect(urls[0]).toBe('http://127.0.0.1:9991')
    expect(urls[urls.length - 1]).toBe(pd.DEFAULT_PROXY_BASE)
  })

  it('session pin is exclusive (no fallback to file/default)', () => {
    process.env.MEDDLE_SESSION_PORT = '9123'
    writeFileSync(join(home, 'mcp-proxy-url.json'), JSON.stringify({
      proxyUrl: 'http://127.0.0.1:9991',
    }))
    const pd = require('../bin/lib/proxy-detect')
    expect(pd.getCandidateProxyUrls()).toEqual(['http://127.0.0.1:9123'])
  })
})

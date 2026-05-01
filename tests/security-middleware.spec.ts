import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import {
  generateAuthToken,
  getOrCreateAuthToken,
  isPathSafe,
  createAuthMiddleware,
  createCORSMiddleware,
  createSecurityHeadersMiddleware,
  createRateLimitMiddleware,
  encryptSensitiveData,
  decryptSensitiveData,
  rateLimitStore,
  RATE_LIMIT_MAX,
} from '../server/security-middleware'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-sec-test-'))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: any = {}) {
  return {
    ip: '127.0.0.1',
    hostname: 'localhost',
    headers: {},
    query: {},
    body: {},
    ...overrides,
  }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    _body: null as any,
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    removeHeader(name: string) {
      delete this.headers[name]
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(data: any) {
      this._body = data
      return this
    },
    getHeaders() {
      return this.headers
    },
    end() {
      // noop
    },
  }
}

// ---------------------------------------------------------------------------
// generateAuthToken
// ---------------------------------------------------------------------------

describe('generateAuthToken', () => {
  it('generates a token with default length 32 (64 hex chars)', () => {
    const token = generateAuthToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates a token with custom length', () => {
    const token = generateAuthToken(16)
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates hex-format output', () => {
    const token = generateAuthToken()
    expect(token).toMatch(/^[0-9a-f]+$/)
  })
})

// ---------------------------------------------------------------------------
// getOrCreateAuthToken
// ---------------------------------------------------------------------------

describe('getOrCreateAuthToken', () => {
  const ENV_KEY = 'EP_AUTH_TOKEN'
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY]
    delete process.env[ENV_KEY]
  })

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env[ENV_KEY] = originalEnv
    } else {
      delete process.env[ENV_KEY]
    }
  })

  it('returns EP_AUTH_TOKEN env var when set', () => {
    process.env[ENV_KEY] = 'abcdef1234567890abcdef'
    const token = getOrCreateAuthToken(tmpDir)
    expect(token).toBe('abcdef1234567890abcdef')
  })

  it('falls through when env var is shorter than 16 chars', () => {
    process.env[ENV_KEY] = 'short'
    const subDir = fs.mkdtempSync(path.join(tmpDir, 'sub-'))
    const tokenPath = path.join(subDir, '.ep-auth-token')
    fs.writeFileSync(tokenPath, 'file-token-16chars!!', 'utf8')

    const token = getOrCreateAuthToken(subDir)
    expect(token).toBe('file-token-16chars!!')
  })

  it('reads from existing token file', () => {
    const subDir = fs.mkdtempSync(path.join(tmpDir, 'sub-'))
    const tokenPath = path.join(subDir, '.ep-auth-token')
    fs.writeFileSync(tokenPath, 'existing-token-16chars!!', 'utf8')

    const token = getOrCreateAuthToken(subDir)
    expect(token).toBe('existing-token-16chars!!')
  })

  it('generates and writes a new token when neither env nor file exists', () => {
    const subDir = fs.mkdtempSync(path.join(tmpDir, 'sub-'))
    const token = getOrCreateAuthToken(subDir)

    expect(token).toMatch(/^[0-9a-f]{64}$/)

    const tokenPath = path.join(subDir, '.ep-auth-token')
    expect(fs.existsSync(tokenPath)).toBe(true)
    expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe(token)
  })
})

// ---------------------------------------------------------------------------
// isPathSafe
// ---------------------------------------------------------------------------

describe('isPathSafe', () => {
  it('allows normal paths within the base directory', () => {
    expect(isPathSafe('/safe/dir/file.txt', '/safe/dir')).toBe(true)
  })

  it('allows paths in a subdirectory', () => {
    expect(isPathSafe('/safe/dir/sub/foo.js', '/safe/dir')).toBe(true)
  })

  it('blocks paths with ../ traversal', () => {
    expect(isPathSafe('/safe/dir/../../etc/passwd', '/safe/dir')).toBe(false)
  })

  it('blocks /etc/passwd directly', () => {
    expect(isPathSafe('/etc/passwd', '/safe/dir')).toBe(false)
  })

  it('blocks paths with ~ (home dir reference)', () => {
    expect(isPathSafe('~/evil.sh', '/safe/dir')).toBe(false)
  })

  it('blocks paths containing null bytes', () => {
    expect(isPathSafe('/safe/dir/valid\x00.txt', '/safe/dir')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createAuthMiddleware
// ---------------------------------------------------------------------------

describe('createAuthMiddleware', () => {
  const TOKEN = 'my-secure-test-token'

  it('allows localhost requests without a token', () => {
    const middleware = createAuthMiddleware(TOKEN)
    const req = mockReq({ ip: '127.0.0.1' })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(true)
    expect(res.statusCode).toBe(200)
  })

  it('allows requests with valid token in X-EP-Auth header', () => {
    const middleware = createAuthMiddleware(TOKEN)
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { 'x-ep-auth': TOKEN },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(true)
  })

  it('allows requests with valid token in _ep_auth query param', () => {
    const middleware = createAuthMiddleware(TOKEN)
    const req = mockReq({
      ip: '10.0.0.1',
      query: { _ep_auth: TOKEN },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(true)
  })

  it('rejects requests with an invalid token', () => {
    const middleware = createAuthMiddleware(TOKEN)
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { 'x-ep-auth': 'wrong-token' },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(401)
    expect(res._body?.error).toBe('Unauthorized')
  })

  it('rejects requests with no token', () => {
    const middleware = createAuthMiddleware(TOKEN)
    const req = mockReq({ ip: '10.0.0.1' })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(401)
  })

  it('bypasses auth when enabled is false', () => {
    const middleware = createAuthMiddleware(TOKEN, false)
    const req = mockReq({ ip: '10.0.0.1' })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(nextCalled).toBe(true)
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// createCORSMiddleware
// ---------------------------------------------------------------------------

describe('createCORSMiddleware', () => {
  it('allows origin from localhost:8989', () => {
    const middleware = createCORSMiddleware()
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { origin: 'http://localhost:8989' },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['Access-Control-Allow-Origin']).toBe('http://localhost:8989')
    expect(nextCalled).toBe(true)
  })

  it('allows custom origins in config', () => {
    const middleware = createCORSMiddleware(['http://custom-origin.com'])
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { origin: 'http://custom-origin.com' },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['Access-Control-Allow-Origin']).toBe('http://custom-origin.com')
    expect(nextCalled).toBe(true)
  })

  it('restricts origin for external origins not in the allow list', () => {
    const middleware = createCORSMiddleware()
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { origin: 'http://evil-attacker.com' },
    })
    const res = mockRes()
    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['Access-Control-Allow-Origin']).toBe('http://localhost:8989')
    expect(nextCalled).toBe(true)
  })

  it('sets standard CORS headers', () => {
    const middleware = createCORSMiddleware()
    const req = mockReq({
      ip: '10.0.0.1',
      headers: { origin: 'http://localhost:8989' },
    })
    const res = mockRes()
    const next = () => {}

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS')
    expect(res.getHeaders()['Access-Control-Allow-Headers']).toBe('Content-Type, X-EP-Auth')
    expect(res.getHeaders()['Access-Control-Max-Age']).toBe('86400')
  })
})

// ---------------------------------------------------------------------------
// createSecurityHeadersMiddleware
// ---------------------------------------------------------------------------

describe('createSecurityHeadersMiddleware', () => {
  it('removes X-Powered-By header', () => {
    const middleware = createSecurityHeadersMiddleware()
    const req = mockReq()
    const res = mockRes()
    res.setHeader('X-Powered-By', 'Express')

    let nextCalled = false
    const next = () => { nextCalled = true }

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['X-Powered-By']).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  it('sets X-Content-Type-Options header', () => {
    const middleware = createSecurityHeadersMiddleware()
    const req = mockReq()
    const res = mockRes()
    const next = () => {}

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['X-Content-Type-Options']).toBe('nosniff')
  })

  it('sets X-Frame-Options header', () => {
    const middleware = createSecurityHeadersMiddleware()
    const req = mockReq()
    const res = mockRes()
    const next = () => {}

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['X-Frame-Options']).toBe('DENY')
  })

  it('sets Cache-Control header to no-store', () => {
    const middleware = createSecurityHeadersMiddleware()
    const req = mockReq()
    const res = mockRes()
    const next = () => {}

    middleware(req as any, res as any, next)

    expect(res.getHeaders()['Cache-Control']).toBe('no-store')
  })
})

// ---------------------------------------------------------------------------
// createRateLimitMiddleware
// ---------------------------------------------------------------------------

describe('createRateLimitMiddleware', () => {
  beforeEach(() => {
    rateLimitStore.clear()
  })

  it('allows requests under the limit', () => {
    const middleware = createRateLimitMiddleware()
    const req = mockReq({ ip: '10.0.0.10' })
    const res = mockRes()
    let nextCalls = 0
    const next = () => { nextCalls++ }

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      middleware(req as any, res as any, next)
    }

    expect(nextCalls).toBe(RATE_LIMIT_MAX)
  })

  it('blocks requests after exceeding the limit', () => {
    const middleware = createRateLimitMiddleware()
    const req = mockReq({ ip: '10.0.0.11' })
    const res = mockRes()
    let nextCalls = 0
    const next = () => { nextCalls++ }

    // Exhaust the limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      middleware(req as any, res as any, next)
    }
    expect(nextCalls).toBe(RATE_LIMIT_MAX)

    // Next request should be blocked
    middleware(req as any, res as any, next)
    expect(nextCalls).toBe(RATE_LIMIT_MAX)
    expect(res.statusCode).toBe(429)
    expect(res._body?.error).toBe('Rate limit exceeded')
  })

  it('tracks independent limits per IP', () => {
    const middleware = createRateLimitMiddleware()
    const reqA = mockReq({ ip: '10.0.0.20' })
    const reqB = mockReq({ ip: '10.0.0.21' })
    const resA = mockRes()
    const resB = mockRes()
    let nextCallsA = 0
    let nextCallsB = 0
    const nextA = () => { nextCallsA++ }
    const nextB = () => { nextCallsB++ }

    // Exhaust IP A
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      middleware(reqA as any, resA as any, nextA)
    }
    expect(nextCallsA).toBe(RATE_LIMIT_MAX)

    // IP B should still have a fresh limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      middleware(reqB as any, resB as any, nextB)
    }
    expect(nextCallsB).toBe(RATE_LIMIT_MAX)

    // IP A blocked
    middleware(reqA as any, resA as any, nextA)
    expect(nextCallsA).toBe(RATE_LIMIT_MAX)
    expect(resA.statusCode).toBe(429)

    // IP B should also be blocked now (its limit is exhausted too)
    middleware(reqB as any, resB as any, nextB)
    expect(nextCallsB).toBe(RATE_LIMIT_MAX)
  })
})

// ---------------------------------------------------------------------------
// encryptSensitiveData / decryptSensitiveData
// ---------------------------------------------------------------------------

describe('encryptSensitiveData / decryptSensitiveData', () => {
  const TOKEN = 'test-auth-token-for-encryption'
  const DATA = 'my-super-secret-api-key-12345'

  it('encrypts and decrypts correctly (round-trip)', () => {
    const encrypted = encryptSensitiveData(DATA, TOKEN)
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)

    const decrypted = decryptSensitiveData(encrypted, TOKEN)
    expect(decrypted).toBe(DATA)
  })

  it('returns null when decrypting with the wrong token', () => {
    const encrypted = encryptSensitiveData(DATA, TOKEN)
    const result = decryptSensitiveData(encrypted, 'wrong-token')
    expect(result).toBeNull()
  })

  it('returns null for tampered encrypted data', () => {
    const encrypted = encryptSensitiveData(DATA, TOKEN)

    // Tamper with the encrypted payload portion
    const parts = encrypted.split(':')
    parts[2] = '0000' + parts[2].slice(4)
    const tampered = parts.join(':')

    expect(decryptSensitiveData(tampered, TOKEN)).toBeNull()
  })
})

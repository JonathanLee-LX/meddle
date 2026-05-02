import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import {
  isSensitiveField,
  encryptValue,
  decryptValue,
  encryptSensitiveFields,
  decryptSensitiveFields,
  SecureSettingsManager,
} from '../core/secure-settings'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-ss-test-'))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// isSensitiveField
// ---------------------------------------------------------------------------

describe('isSensitiveField', () => {
  it('matches apiKey case-insensitively', () => {
    expect(isSensitiveField('apiKey')).toBe(true)
    expect(isSensitiveField('apikey')).toBe(true)
    expect(isSensitiveField('APIKEY')).toBe(true)
    expect(isSensitiveField('ApiKey')).toBe(true)
  })

  it('matches api_key', () => {
    expect(isSensitiveField('api_key')).toBe(true)
    expect(isSensitiveField('API_KEY')).toBe(true)
  })

  it('matches secret', () => {
    expect(isSensitiveField('secret')).toBe(true)
    expect(isSensitiveField('clientSecret')).toBe(true)
    expect(isSensitiveField('SECRET')).toBe(true)
  })

  it('matches password', () => {
    expect(isSensitiveField('password')).toBe(true)
    expect(isSensitiveField('PASSWORD')).toBe(true)
  })

  it('matches token', () => {
    expect(isSensitiveField('token')).toBe(true)
    expect(isSensitiveField('accessToken')).toBe(true)
    expect(isSensitiveField('refresh_token')).toBe(true)
    expect(isSensitiveField('TOKEN')).toBe(true)
  })

  it('returns false for non-sensitive fields', () => {
    expect(isSensitiveField('username')).toBe(false)
    expect(isSensitiveField('host')).toBe(false)
    expect(isSensitiveField('port')).toBe(false)
    expect(isSensitiveField('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// encryptValue / decryptValue
// ---------------------------------------------------------------------------

describe('encryptValue / decryptValue', () => {
  it('encrypts and decrypts a simple string', () => {
    const original = 'my-secret-key'
    const encrypted = encryptValue(original)
    expect(encrypted).toMatch(/^enc:[0-9a-f]+:[0-9a-f]+$/)
    expect(encrypted).not.toBe(original)

    const decrypted = decryptValue(encrypted)
    expect(decrypted).toBe(original)
  })

  it('encrypts and decrypts a string with special characters', () => {
    const original = 'sk-123!@#$%^&*()_+-='
    const encrypted = encryptValue(original)
    const decrypted = decryptValue(encrypted)
    expect(decrypted).toBe(original)
  })

  it('encrypts and decrypts an empty-ish string to itself', () => {
    expect(encryptValue('')).toBe('')
  })

  it('returns the original value for decryptValue when prefix is not enc:', () => {
    expect(decryptValue('hello-world')).toBe('hello-world')
    expect(decryptValue('not-encrypted')).toBe('not-encrypted')
    expect(decryptValue('')).toBe('')
  })

  it('returns the original value when encrypted format is invalid', () => {
    // Too few parts
    expect(decryptValue('enc:abc')).toBe('enc:abc')
    // Too many parts
    expect(decryptValue('enc:a:b:c')).toBe('enc:a:b:c')
  })
})

// ---------------------------------------------------------------------------
// encryptSensitiveFields
// ---------------------------------------------------------------------------

describe('encryptSensitiveFields', () => {
  it('encrypts fields named apiKey, password, token, secret', () => {
    const input = {
      apiKey: 'my-api-key',
      password: 'my-password',
      token: 'my-token',
      secret: 'my-secret',
    }
    const result = encryptSensitiveFields(input)

    expect(result.apiKey).toMatch(/^enc:/)
    expect(result.password).toMatch(/^enc:/)
    expect(result.token).toMatch(/^enc:/)
    expect(result.secret).toMatch(/^enc:/)
  })

  it('leaves non-sensitive fields unchanged', () => {
    const input = {
      username: 'admin',
      host: 'localhost',
      port: 8080,
      enabled: true,
    }
    const result = encryptSensitiveFields(input)

    expect(result.username).toBe('admin')
    expect(result.host).toBe('localhost')
    expect(result.port).toBe(8080)
    expect(result.enabled).toBe(true)
  })

  it('recursively encrypts sensitive fields in nested objects', () => {
    const input = {
      name: 'My Plugin',
      config: {
        apiKey: 'nested-key',
        timeout: 5000,
      },
    }
    const result = encryptSensitiveFields(input)

    expect(result.name).toBe('My Plugin')
    expect(result.config.apiKey).toMatch(/^enc:/)
    expect(result.config.timeout).toBe(5000)
  })

  it('handles null values', () => {
    const input = { apiKey: null, name: 'test' }
    const result = encryptSensitiveFields(input)

    expect(result.apiKey).toBeNull()
    expect(result.name).toBe('test')
  })
})

// ---------------------------------------------------------------------------
// decryptSensitiveFields
// ---------------------------------------------------------------------------

describe('decryptSensitiveFields', () => {
  it('decrypts encrypted fields back to plain text', () => {
    const encrypted = encryptSensitiveFields({
      apiKey: 'secret-key',
      name: 'hello',
    })
    const decrypted = decryptSensitiveFields(encrypted)

    expect(decrypted.apiKey).toBe('secret-key')
    expect(decrypted.name).toBe('hello')
  })

  it('leaves plain text non-encrypted fields alone', () => {
    const input = { host: 'localhost', port: 3000 }
    const result = decryptSensitiveFields(input)

    expect(result.host).toBe('localhost')
    expect(result.port).toBe(3000)
  })

  it('recursively decrypts nested encrypted fields', () => {
    const encrypted = encryptSensitiveFields({
      config: {
        apiKey: 'deep-secret',
      },
    })
    const decrypted = decryptSensitiveFields(encrypted)

    expect(decrypted.config.apiKey).toBe('deep-secret')
  })
})

// ---------------------------------------------------------------------------
// SecureSettingsManager
// ---------------------------------------------------------------------------

describe('SecureSettingsManager', () => {
  it('loads settings from an existing file', () => {
    const settingsPath = path.join(tmpDir, 'load-test.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', fontSize: 14 }), 'utf8')

    const manager = new SecureSettingsManager(settingsPath)

    expect(manager.get('theme')).toBe('dark')
    expect(manager.get('fontSize')).toBe(14)
  })

  it('handles missing settings file gracefully', () => {
    const settingsPath = path.join(tmpDir, 'nonexistent.json')
    const manager = new SecureSettingsManager(settingsPath)

    expect(manager.get('anything')).toBeUndefined()
  })

  it('persists settings via set() and makes them available via get()', () => {
    const settingsPath = path.join(tmpDir, 'persist-test.json')
    const manager = new SecureSettingsManager(settingsPath)

    manager.set('username', 'admin')
    expect(manager.get('username')).toBe('admin')
  })

  it('writes encrypted values to disk for sensitive fields', () => {
    const settingsPath = path.join(tmpDir, 'encrypt-write-test.json')
    const manager = new SecureSettingsManager(settingsPath)

    manager.set('apiKey', 'my-secret-key')

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(raw.apiKey).toMatch(/^enc:/)
  })

  it('setAIConfig encrypts apiKey and getAIConfig decrypts it', () => {
    const settingsPath = path.join(tmpDir, 'ai-config-test.json')
    const manager = new SecureSettingsManager(settingsPath)

    manager.setAIConfig({
      provider: 'openai',
      apiKey: 'sk-1234567890',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4',
    })

    const config = manager.getAIConfig()
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('sk-1234567890')
    expect(config!.baseUrl).toBe('https://api.openai.com')
    expect(config!.model).toBe('gpt-4')
  })

  it('setAIConfig stores encrypted apiKey in the file', () => {
    const settingsPath = path.join(tmpDir, 'ai-encrypted-file.json')
    const manager = new SecureSettingsManager(settingsPath)

    manager.setAIConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-abcdef',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-3',
    })

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(raw.aiConfig.apiKey).toMatch(/^enc:/)
    expect(raw.aiConfig.provider).toBe('anthropic')
    expect(raw.aiConfig.baseUrl).toBe('https://api.anthropic.com')
    expect(raw.aiConfig.model).toBe('claude-3')
  })

  it('persists AI config through save/load cycle', () => {
    const settingsPath = path.join(tmpDir, 'ai-persist-cycle.json')
    const manager1 = new SecureSettingsManager(settingsPath)

    manager1.setAIConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-persist',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4',
    })

    const manager2 = new SecureSettingsManager(settingsPath)
    const config = manager2.getAIConfig()

    expect(config).not.toBeNull()
    expect(config!.provider).toBe('anthropic')
    expect(config!.apiKey).toBe('sk-ant-persist')
    expect(config!.baseUrl).toBe('https://api.anthropic.com')
    expect(config!.model).toBe('claude-opus-4')
  })

  it('getAll returns all settings', () => {
    const settingsPath = path.join(tmpDir, 'get-all-test.json')
    const manager = new SecureSettingsManager(settingsPath)

    manager.set('theme', 'light')
    manager.set('fontSize', 12)
    manager.set('apiKey', 'test-key')

    const all = manager.getAll()
    expect(all.theme).toBe('light')
    expect(all.fontSize).toBe(12)
    expect(all.apiKey).toBe('test-key')
  })

  it('get returns fallback when key does not exist', () => {
    const settingsPath = path.join(tmpDir, 'fallback-test.json')
    const manager = new SecureSettingsManager(settingsPath)

    expect(manager.get('nonexistent', 'default-val')).toBe('default-val')
  })

  it('getAIConfig returns null when no AI config is set', () => {
    const settingsPath = path.join(tmpDir, 'no-ai-config.json')
    const manager = new SecureSettingsManager(settingsPath)

    expect(manager.getAIConfig()).toBeNull()
  })
})

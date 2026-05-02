/**
 * Secure Settings Manager
 * Handles encryption of sensitive settings like API keys
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Fields that should be encrypted
const SENSITIVE_FIELDS = ['apiKey', 'api_key', 'secret', 'password', 'token']

// Encryption key derived from machine-specific identifier
function getEncryptionKey(): Buffer {
    // Use a combination of machine hostname and fixed salt
    // This ensures settings are only decryptable on the same machine
    const hostname = require('os').hostname()
    const salt = 'easy-proxy-v1'
    return crypto.createHash('sha256').update(hostname + salt).digest()
}

/**
 * Encrypt a value
 */
export function encryptValue(value: string): string {
    if (!value || value.length === 0) return value

    const key = getEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)

    let encrypted = cipher.update(value, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    return `enc:${iv.toString('hex')}:${encrypted}`
}

/**
 * Decrypt a value
 */
export function decryptValue(encryptedValue: string): string {
    if (!encryptedValue.startsWith('enc:')) {
        return encryptedValue // Not encrypted
    }

    try {
        const parts = encryptedValue.split(':')
        if (parts.length !== 3) return encryptedValue

        const key = getEncryptionKey()
        const iv = Buffer.from(parts[1], 'hex')
        const encrypted = parts[2]

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)

        let decrypted = decipher.update(encrypted, 'hex', 'utf8')
        decrypted += decipher.final('utf8')

        return decrypted
    } catch (_e) {
        // Decryption failed, return original value
        return encryptedValue
    }
}

/**
 * Check if a field name is sensitive
 */
export function isSensitiveField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase()
    return SENSITIVE_FIELDS.some(s => lower.includes(s.toLowerCase()))
}

/**
 * Encrypt sensitive fields in an object
 */
export function encryptSensitiveFields(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && isSensitiveField(key)) {
            result[key] = encryptValue(value)
        } else if (typeof value === 'object' && value !== null) {
            result[key] = encryptSensitiveFields(value)
        } else {
            result[key] = value
        }
    }

    return result
}

/**
 * Decrypt sensitive fields in an object
 */
export function decryptSensitiveFields(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            result[key] = decryptValue(value)
        } else if (typeof value === 'object' && value !== null) {
            result[key] = decryptSensitiveFields(value)
        } else {
            result[key] = value
        }
    }

    return result
}

/**
 * Settings manager with encryption support
 */
export class SecureSettingsManager {
    private filePath: string
    private settings: Record<string, any>

    constructor(filePath: string) {
        this.filePath = filePath
        this.settings = {}
        this.load()
    }

    /**
     * Load settings from file
     */
    load(): void {
        if (fs.existsSync(this.filePath)) {
            try {
                const content = fs.readFileSync(this.filePath, 'utf8')
                const rawSettings = JSON.parse(content)
                this.settings = decryptSensitiveFields(rawSettings)
            } catch (_e) {
                this.settings = {}
            }
        }
    }

    /**
     * Save settings to file
     */
    save(): void {
        const encryptedSettings = encryptSensitiveFields(this.settings)
        fs.writeFileSync(this.filePath, JSON.stringify(encryptedSettings, null, 2), 'utf8')
    }

    /**
     * Get a setting value
     */
    get<T = unknown>(key: string, fallback?: T): T {
        return this.settings[key] ?? fallback
    }

    /**
     * Set a setting value (encrypts if sensitive)
     */
    set(key: string, value: unknown): void {
        this.settings[key] = value
        this.save()
    }

    /**
     * Get AI config (decrypts apiKey automatically)
     */
    getAIConfig(): {
        provider: 'openai' | 'anthropic'
        apiKey: string
        baseUrl: string
        model: string
    } | null {
        const aiConfig = this.settings.aiConfig
        if (!aiConfig) return null

        return {
            provider: aiConfig.provider || 'openai',
            apiKey: decryptValue(aiConfig.apiKey || ''),
            baseUrl: aiConfig.baseUrl || '',
            model: aiConfig.model || 'gpt-4',
        }
    }

    /**
     * Set AI config (encrypts apiKey automatically)
     */
    setAIConfig(config: {
        provider: 'openai' | 'anthropic'
        apiKey: string
        baseUrl: string
        model: string
    }): void {
        this.settings.aiConfig = {
            provider: config.provider,
            apiKey: encryptValue(config.apiKey),
            baseUrl: config.baseUrl,
            model: config.model,
        }
        this.save()
    }

    /**
     * Get all settings (decrypted)
     */
    getAll(): Record<string, any> {
        return { ...this.settings }
    }
}

/**
 * Create settings manager for easy-proxy
 */
export function createSettingsManager(epDir: string): SecureSettingsManager {
    const filePath = path.resolve(epDir, 'settings.json')
    return new SecureSettingsManager(filePath)
}
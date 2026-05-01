/**
 * Security Middleware for Easy-Proxy
 * Provides authentication, CORS restrictions, and input validation
 */

import { Application, Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// Auth token configuration
const AUTH_TOKEN_ENV = 'EP_AUTH_TOKEN'
const AUTH_TOKEN_FILE = '.ep-auth-token'
const DEFAULT_TOKEN_LENGTH = 32

export interface SecurityConfig {
    authToken?: string
    corsOrigins?: string[]
    enableAuth?: boolean
}

/**
 * Generate a random auth token
 */
export function generateAuthToken(length: number = DEFAULT_TOKEN_LENGTH): string {
    return crypto.randomBytes(length).toString('hex')
}

/**
 * Get or create auth token
 * Priority: env variable > existing file > generate new
 */
export function getOrCreateAuthToken(epDir: string): string {
    // Check environment variable first
    const envToken = process.env[AUTH_TOKEN_ENV]
    if (envToken && envToken.length >= 16) {
        return envToken
    }

    // Check existing token file
    const tokenPath = path.resolve(epDir, AUTH_TOKEN_FILE)
    if (fs.existsSync(tokenPath)) {
        try {
            const existingToken = fs.readFileSync(tokenPath, 'utf8').trim()
            if (existingToken && existingToken.length >= 16) {
                return existingToken
            }
        } catch (e) {
            // Ignore read errors
        }
    }

    // Generate new token
    const newToken = generateAuthToken()
    try {
        fs.writeFileSync(tokenPath, newToken, 'utf8')
        console.log(`[security] Generated new auth token, saved to ${tokenPath}`)
        console.log(`[security] Token: ${newToken}`)
        console.log(`[security] Use this token in X-EP-Auth header or query param _ep_auth`)
    } catch (e) {
        console.error('[security] Failed to save auth token file:', e)
    }

    return newToken
}

/**
 * Validate auth token from request
 */
function validateAuthToken(req: Request, token: string): boolean {
    // Check header
    const headerToken = req.headers['x-ep-auth']
    if (headerToken === token) {
        return true
    }

    // Check query parameter
    const queryToken = req.query['_ep_auth']
    if (queryToken === token) {
        return true
    }

    // Check body (for POST requests)
    const bodyToken = req.body?.['_ep_auth']
    if (bodyToken === token) {
        return true
    }

    return false
}

/**
 * Check if request is from localhost
 */
function isLocalhostRequest(req: Request): boolean {
    const ip = req.ip || req.connection.remoteAddress || ''
    const host = req.headers.host || ''

    // Check IP
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
        return true
    }

    // Check host header
    if (host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1')) {
        return true
    }

    return false
}

/**
 * Validate file path to prevent path traversal
 * Returns true if path is safe, false otherwise
 */
export function isPathSafe(requestedPath: string, baseDir: string): boolean {
    // Normalize paths
    const normalizedBase = path.resolve(baseDir)
    const normalizedRequested = path.resolve(requestedPath)

    // Check if requested path is within base directory
    if (!normalizedRequested.startsWith(normalizedBase + path.sep) && normalizedRequested !== normalizedBase) {
        return false
    }

    // Check for null bytes (potential path traversal bypass)
    if (normalizedRequested.includes('\0')) {
        return false
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
        '..',
        '~',
        '/etc/',
        '/var/',
        '/usr/',
        '/root/',
        '/home/',
        '\\Windows\\',
        '\\Program Files\\',
    ]

    const lowerPath = normalizedRequested.toLowerCase()
    for (const pattern of suspiciousPatterns) {
        if (lowerPath.includes(pattern.toLowerCase())) {
            return false
        }
    }

    return true
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(token: string, enabled: boolean = true) {
    return (req: Request, res: Response, next: NextFunction) => {
        // Skip auth for localhost if enabled
        if (!enabled || isLocalhostRequest(req)) {
            return next()
        }

        // Validate token
        if (validateAuthToken(req, token)) {
            return next()
        }

        // Reject unauthorized
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid auth token required. Use X-EP-Auth header or _ep_auth query parameter.',
            hint: 'Token can be found in ~/.ep/.ep-auth-token file or set via EP_AUTH_TOKEN env variable'
        })
    }
}

/**
 * Create CORS middleware restricted to localhost
 */
export function createCORSMiddleware(allowedOrigins: string[] = ['http://localhost:8989', 'http://127.0.0.1:8989']) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const origin = req.headers.origin

        // For localhost requests, allow
        if (!origin || isLocalhostRequest(req)) {
            res.setHeader('Access-Control-Allow-Origin', origin || '*')
        } else if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin)
        } else {
            // Restrict CORS for non-localhost
            res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8989')
        }

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-EP-Auth')
        res.setHeader('Access-Control-Max-Age', '86400')

        if (req.method === 'OPTIONS') {
            res.status(204).end()
            return
        }

        next()
    }
}

/**
 * Security headers middleware
 */
export function createSecurityHeadersMiddleware() {
    return (_req: Request, res: Response, next: NextFunction) => {
        // Remove server header
        res.removeHeader('X-Powered-By')

        // Add security headers
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('X-Frame-Options', 'DENY')

        // Don't expose internal paths
        res.setHeader('Cache-Control', 'no-store')

        next()
    }
}

/**
 * Rate limiting middleware (simple in-memory)
 */
export const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
export const RATE_LIMIT_MAX = 100 // 100 requests per minute

export function createRateLimitMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown'
        const now = Date.now()

        const entry = rateLimitStore.get(ip)
        if (!entry || entry.resetAt < now) {
            rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
            return next()
        }

        if (entry.count >= RATE_LIMIT_MAX) {
            res.status(429).json({
                error: 'Rate limit exceeded',
                message: `Too many requests. Max ${RATE_LIMIT_MAX} requests per minute.`,
                retryAfter: Math.ceil((entry.resetAt - now) / 1000)
            })
            return
        }

        entry.count++
        return next()
    }
}

/**
 * Apply all security middleware to the app
 */
export function applySecurityMiddleware(
    app: Application,
    epDir: string,
    config: SecurityConfig = {}
): { token: string } {
    // Get or create auth token
    const token = config.authToken || getOrCreateAuthToken(epDir)
    const enableAuth = config.enableAuth !== false // Default to enabled

    // Apply security headers
    app.use(createSecurityHeadersMiddleware())

    // Apply CORS
    app.use(createCORSMiddleware(config.corsOrigins))

    // Apply rate limiting
    app.use(createRateLimitMiddleware())

    // Apply authentication (skip for WebSocket upgrade and health check)
    app.use((req: Request, res: Response, next: NextFunction) => {
        // Skip auth for WebSocket upgrade
        if (req.headers.upgrade === 'websocket') {
            return next()
        }

        // Skip auth for health check endpoint
        if (req.path === '/api/health' || req.path === '/health') {
            return next()
        }

        createAuthMiddleware(token, enableAuth)(req, res, next)
    })

    // Log security status
    console.log('[security] Security middleware applied')
    console.log(`[security] Authentication: ${enableAuth ? 'enabled' : 'disabled'}`)
    console.log(`[security] CORS: restricted to localhost`)
    console.log(`[security] Rate limit: ${RATE_LIMIT_MAX} requests/minute`)

    return { token }
}

/**
 * Simple encryption for sensitive data (like API keys)
 * Uses AES-256-GCM with a key derived from the auth token
 */
export function encryptSensitiveData(data: string, token: string): string {
    const key = crypto.createHash('sha256').update(token).digest()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')

    return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

export function decryptSensitiveData(encryptedData: string, token: string): string | null {
    try {
        const parts = encryptedData.split(':')
        if (parts.length !== 3) return null

        const key = crypto.createHash('sha256').update(token).digest()
        const iv = Buffer.from(parts[0], 'hex')
        const authTag = Buffer.from(parts[1], 'hex')
        const encrypted = parts[2]

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(authTag)

        let decrypted = decipher.update(encrypted, 'hex', 'utf8')
        decrypted += decipher.final('utf8')

        return decrypted
    } catch (e) {
        return null
    }
}
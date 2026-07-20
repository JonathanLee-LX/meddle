import { describe, it, expect } from 'vitest'
import { openBrowserWithProxy } from '../core/browser'

describe('browser openBrowserWithProxy', () => {
    it('is a function', () => {
        expect(typeof openBrowserWithProxy).toBe('function')
    })

    it('accepts url, proxyServer, meddleDir, and optional remoteDebuggingPort', () => {
        expect(openBrowserWithProxy.length >= 3).toBeTruthy()
    })

    it('returns a boolean value', () => {
        const result = openBrowserWithProxy('http://localhost:8989', '127.0.0.1:8989', '/tmp/meddle-browser-test', undefined)
        expect(typeof result).toBe('boolean')
    })
})

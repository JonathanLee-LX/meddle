import { afterAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { closeLaunchedBrowsers, findInstalledBrowser, openBrowserWithProxy } from '../core/browser'

const tempDirs: string[] = []

function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

function writeExecutable(file: string, body: string): void {
    fs.writeFileSync(file, body, { mode: 0o755 })
}

afterAll(() => {
    closeLaunchedBrowsers()
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('browser openBrowserWithProxy', () => {
    it('is a function', () => {
        expect(typeof openBrowserWithProxy).toBe('function')
    })

    it('accepts url, proxyServer, meddleDir, and optional remoteDebuggingPort', () => {
        expect(openBrowserWithProxy.length >= 3).toBeTruthy()
    })

    // PATH tricks below are Linux-specific. GitHub CI has no Chrome, so these
    // stand in for the real binary and still fail if launch blocks the worker.
    it.skipIf(process.platform !== 'linux')('returns false quickly when no browser is on PATH', async () => {
        const dir = tempDir('meddle-browser-none-')
        const oldPath = process.env.PATH
        process.env.PATH = tempDir('meddle-browser-empty-path-')
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const started = Date.now()
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            expect(result).toBe(false)
            expect(Date.now() - started).toBeLessThan(1500)
        } finally {
            process.env.PATH = oldPath
            error.mockRestore()
            closeLaunchedBrowsers()
        }
    }, 8_000)

    it.skipIf(process.platform !== 'linux')('does not wait for a browser process that never exits', async () => {
        const bin = tempDir('meddle-browser-bin-')
        writeExecutable(path.join(bin, 'google-chrome'), '#!/bin/sh\nwhile true; do sleep 1; done\n')
        const dir = tempDir('meddle-browser-profile-')
        const oldPath = process.env.PATH
        process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ''}`
        const started = Date.now()
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            const elapsed = Date.now() - started
            expect(result).toBe(true)
            expect(elapsed).toBeGreaterThanOrEqual(400)
            expect(elapsed).toBeLessThan(4_000)
        } finally {
            process.env.PATH = oldPath
            closeLaunchedBrowsers()
        }
    }, 8_000)

    it.skipIf(process.platform !== 'linux')('treats exit 0 as opened and does not fall back', async () => {
        const bin = tempDir('meddle-browser-handoff-')
        const chromeLog = path.join(bin, 'chrome.log')
        const openLog = path.join(bin, 'xdg.log')
        writeExecutable(path.join(bin, 'google-chrome'), `#!/bin/sh\necho chrome >> "${chromeLog}"\nexit 0\n`)
        writeExecutable(path.join(bin, 'xdg-open'), `#!/bin/sh\necho xdg >> "${openLog}"\nexit 0\n`)
        const dir = tempDir('meddle-browser-handoff-profile-')
        const oldPath = process.env.PATH
        process.env.PATH = bin
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const started = Date.now()
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            expect(result).toBe(true)
            expect(Date.now() - started).toBeLessThan(1_500)
            expect(fs.readFileSync(chromeLog, 'utf8')).toContain('chrome')
            expect(fs.existsSync(openLog)).toBe(false)
            expect(log.mock.calls.flat().join('\n')).not.toContain('未找到 Chrome/Edge')
            expect(error).not.toHaveBeenCalled()
        } finally {
            process.env.PATH = oldPath
            log.mockRestore()
            error.mockRestore()
            closeLaunchedBrowsers()
        }
    }, 8_000)

    it.skipIf(process.platform !== 'linux')('falls back when the browser exits non-zero', async () => {
        const bin = tempDir('meddle-browser-fail-')
        const chromeLog = path.join(bin, 'chrome.log')
        const openLog = path.join(bin, 'xdg.log')
        writeExecutable(path.join(bin, 'google-chrome'), `#!/bin/sh\necho chrome >> "${chromeLog}"\nexit 1\n`)
        writeExecutable(path.join(bin, 'xdg-open'), `#!/bin/sh\necho xdg >> "${openLog}"\nexit 0\n`)
        const dir = tempDir('meddle-browser-fail-profile-')
        const oldPath = process.env.PATH
        process.env.PATH = bin
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            expect(result).toBe(true)
            expect(fs.readFileSync(chromeLog, 'utf8')).toContain('chrome')
            expect(fs.readFileSync(openLog, 'utf8')).toContain('xdg')
            expect(log.mock.calls.flat().join('\n')).toContain('未找到 Chrome/Edge')
        } finally {
            process.env.PATH = oldPath
            log.mockRestore()
            error.mockRestore()
            closeLaunchedBrowsers()
        }
    }, 8_000)

    it.skipIf(process.platform !== 'linux')('kills a fallback opener that does not exit', async () => {
        const bin = tempDir('meddle-browser-fallback-')
        writeExecutable(path.join(bin, 'xdg-open'), '#!/bin/sh\nwhile true; do sleep 1; done\n')
        const dir = tempDir('meddle-browser-fallback-profile-')
        const oldPath = process.env.PATH
        process.env.PATH = bin
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const started = Date.now()
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            const elapsed = Date.now() - started
            expect(result).toBe(false)
            expect(elapsed).toBeGreaterThanOrEqual(1_500)
            expect(elapsed).toBeLessThan(5_000)
        } finally {
            process.env.PATH = oldPath
            error.mockRestore()
            closeLaunchedBrowsers()
        }
    }, 8_000)

    it.skipIf(!findInstalledBrowser())('launches the installed browser and returns without blocking', async () => {
        const dir = tempDir('meddle-browser-real-')
        const started = Date.now()
        try {
            const result = await openBrowserWithProxy('http://127.0.0.1:9', '127.0.0.1:9', dir)
            const elapsed = Date.now() - started
            expect(result).toBe(true)
            expect(elapsed).toBeLessThan(4_000)
        } finally {
            closeLaunchedBrowsers()
        }
    }, 8_000)
})

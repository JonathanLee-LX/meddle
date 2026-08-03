import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
    compareVersions,
    isValidVersion,
    getLatestVersionNpm,
    getLatestVersionGithub,
    getInstallMethod,
    checkForUpdate,
    getAssetName,
    downloadBinaryAsset,
    getAutoUpdate,
    setAutoUpdate,
    runAsyncUpdateCheck,
} from '../bin/lib/update-check'

const servers: http.Server[] = []
const timers: ReturnType<typeof setTimeout>[] = []
const tmpDirs: string[] = []

afterEach(async () => {
    for (const t of timers) clearTimeout(t)
    timers.length = 0
    for (const s of servers.splice(0)) {
        await new Promise<void>((r) => s.close(() => r()))
    }
    for (const d of tmpDirs.splice(0)) {
        fs.rmSync(d, { recursive: true, force: true })
    }
    delete process.env.MEDDLE_AUTO_UPDATE
})

function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meddle-update-'))
    tmpDirs.push(dir)
    return dir
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition')
        await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 10)
            timers.push(t)
        })
    }
}

function jsonServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
    const server = http.createServer(handler)
    servers.push(server)
    return new Promise<{ url: string; port: number }>(async (resolve) => {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const port = (server.address() as { port: number }).port
        resolve({ url: `http://127.0.0.1:${port}`, port })
    })
}

const fetchImpl = (serverUrl: string) => (url: string, init?: RequestInit) =>
    fetch(
        url
            .replace('https://registry.npmjs.org', serverUrl)
            .replace('https://api.github.com', serverUrl)
            .replace('https://github.com', serverUrl),
        init,
    )

describe('compareVersions', () => {
    it('returns 0 for identical versions', () => {
        expect(compareVersions('0.3.1', '0.3.1')).toBe(0)
    })

    it('orders patch/minor/major releases', () => {
        expect(compareVersions('0.3.1', '0.4.0')).toBe(-1)
        expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
        expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    })

    it('treats prerelease as older than the release', () => {
        expect(compareVersions('0.4.0-beta.1', '0.4.0')).toBe(-1)
        expect(compareVersions('0.4.0', '0.4.0-beta.1')).toBe(1)
    })

    it('orders prerelease identifiers', () => {
        expect(compareVersions('0.4.0-alpha.2', '0.4.0-beta.1')).toBe(-1)
        expect(compareVersions('0.4.0-beta.2', '0.4.0-beta.10')).toBe(-1)
    })

    it('accepts a leading v prefix', () => {
        expect(compareVersions('v0.3.1', '0.3.1')).toBe(0)
    })

    it('throws on invalid versions', () => {
        expect(() => compareVersions('not-a-version', '0.3.1')).toThrow()
        expect(isValidVersion('0.3.1')).toBe(true)
        expect(isValidVersion('abc')).toBe(false)
    })
})

describe('getLatestVersionNpm', () => {
    it('returns the version from the npm registry', async () => {
        let requestedPath = ''
        const s = await jsonServer((req, res) => {
            requestedPath = req.url || ''
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '9.9.9' }))
        })
        const version = await getLatestVersionNpm({ fetchImpl: fetchImpl(s.url) })
        expect(version).toBe('9.9.9')
        expect(requestedPath).toBe('/@jonathanleelx/meddle/latest')
    })

    it('rejects when the registry responds with an error', async () => {
        const s = await jsonServer((_req, res) => {
            res.statusCode = 500
            res.end('boom')
        })
        await expect(getLatestVersionNpm({ fetchImpl: fetchImpl(s.url) })).rejects.toThrow()
    })

    it('rejects when the response has no version field', async () => {
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end('{}')
        })
        await expect(getLatestVersionNpm({ fetchImpl: fetchImpl(s.url) })).rejects.toThrow()
    })
})

describe('getLatestVersionGithub', () => {
    it('follows the latest-release redirect to the tag', async () => {
        const s = await jsonServer((_req, res) => {
            res.statusCode = 302
            res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/v1.2.3')
            res.end()
        })
        const version = await getLatestVersionGithub({ fetchImpl: fetchImpl(s.url) })
        expect(version).toBe('1.2.3')
    })

    it('rejects when the redirect does not point to a version tag', async () => {
        const s = await jsonServer((_req, res) => {
            res.statusCode = 302
            res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/not-a-tag')
            res.end()
        })
        await expect(getLatestVersionGithub({ fetchImpl: fetchImpl(s.url) })).rejects.toThrow()
    })

    it('rejects when there is no redirect at all', async () => {
        const s = await jsonServer((_req, res) => {
            res.statusCode = 200
            res.end('ok')
        })
        await expect(getLatestVersionGithub({ fetchImpl: fetchImpl(s.url) })).rejects.toThrow()
    })
})

describe('beta channel', () => {
    it('npm: fetches the beta dist-tag instead of latest', async () => {
        let requestedPath = ''
        const s = await jsonServer((req, res) => {
            requestedPath = req.url || ''
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0-beta.3' }))
        })
        const version = await getLatestVersionNpm({
            fetchImpl: fetchImpl(s.url),
            distTag: 'beta',
        })
        expect(version).toBe('0.4.0-beta.3')
        expect(requestedPath).toBe('/@jonathanleelx/meddle/beta')
    })

    it('binary: resolves the beta version from the npm registry beta dist-tag', async () => {
        let requestedPath = ''
        const s = await jsonServer((req, res) => {
            requestedPath = req.url || ''
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0-beta.3' }))
        })
        const version = await getLatestVersionNpm({
            fetchImpl: fetchImpl(s.url),
            distTag: 'beta',
            registryUrl: `${s.url}/@jonathanleelx/meddle/beta`,
        })
        expect(version).toBe('0.4.0-beta.3')
        expect(requestedPath).toBe('/@jonathanleelx/meddle/beta')
    })

    it('checkForUpdate honors channel=beta through both install methods', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0-beta.3' }))
        })
        const npmResult = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.4.0-beta.2',
            now: 1_000_000,
            ttlMs: 86_400_000,
            channel: 'beta',
            fetchImpl: fetchImpl(s.url),
        })
        expect(npmResult.latest).toBe('0.4.0-beta.3')
        expect(npmResult.outdated).toBe(true)

        const ghResult = await checkForUpdate({
            home,
            installMethod: 'binary',
            current: '0.4.0-beta.2',
            now: 1_000_000,
            ttlMs: 86_400_000,
            channel: 'beta',
            fetchImpl: fetchImpl(s.url),
        })
        expect(ghResult.latest).toBe('0.4.0-beta.3')
    })

    it('checkForUpdate falls back to stable when channel is not beta', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((req, res) => {
            if ((req.url || '').includes('/releases?') || (req.url || '').endsWith('/releases')) {
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify([{ tag_name: 'v0.4.0', prerelease: false }]))
            } else {
                res.statusCode = 302
                res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/v0.4.0')
                res.end()
            }
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'binary',
            current: '0.3.1',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.latest).toBe('0.4.0')
    })

    it('auto-infers beta channel when the current version is a prerelease (npm)', async () => {
        const home = makeTmpDir()
        let requestedPath = ''
        const s = await jsonServer((req, res) => {
            requestedPath = req.url || ''
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0-beta.5' }))
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.4.0-beta.4',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.channel).toBe('beta')
        expect(result.latest).toBe('0.4.0-beta.5')
        expect(requestedPath).toBe('/@jonathanleelx/meddle/beta')
    })

    it('auto-infers beta channel when the current version is a prerelease (binary)', async () => {
        const home = makeTmpDir()
        let requestedPath = ''
        const s = await jsonServer((req, res) => {
            requestedPath = req.url || ''
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0-beta.5' }))
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'binary',
            current: '0.4.0-beta.4',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.channel).toBe('beta')
        expect(result.latest).toBe('0.4.0-beta.5')
        expect(requestedPath).toBe('/@jonathanleelx/meddle/beta')
    })

    it('explicit stable channel overrides the prerelease inference', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((req, res) => {
            if ((req.url || '').includes('/releases?') || (req.url || '').endsWith('/releases')) {
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify([{ tag_name: 'v0.4.0', prerelease: false }]))
            } else {
                res.statusCode = 302
                res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/v0.4.0')
                res.end()
            }
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'binary',
            current: '0.4.0-beta.4',
            now: 1_000_000,
            ttlMs: 86_400_000,
            channel: 'stable',
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.channel).toBe('stable')
        expect(result.latest).toBe('0.4.0')
    })
})

describe('getInstallMethod', () => {
    it('detects npm installation from node_modules path', () => {
        expect(
            getInstallMethod({ moduleDir: '/usr/lib/node_modules/@jonathanleeelx/meddle/bin/lib' }),
        ).toBe('npm')
        expect(
            getInstallMethod({ moduleDir: 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\meddle\\bin\\lib' }),
        ).toBe('npm')
    })

    it('detects binary installation otherwise', () => {
        expect(getInstallMethod({ moduleDir: '/home/u/.meddle/bin/lib' })).toBe('binary')
    })
})

describe('checkForUpdate (cache)', () => {
    it('returns cached latest when the cache is fresh and skips the network', async () => {
        const home = makeTmpDir()
        fs.mkdirSync(path.join(home, '.cache'), { recursive: true })
        fs.writeFileSync(
            path.join(home, '.cache/update-check.json'),
            JSON.stringify({ version: '0.9.9', checkedAt: 1_000_000 }),
        )
        let fetches = 0
        const result = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: async () => {
                fetches++
                return null as never
            },
        })
        expect(result).toEqual({
            current: '0.3.1',
            latest: '0.9.9',
            outdated: true,
            fromCache: true,
            checkedAt: 1_000_000,
            channel: 'stable',
        })
        expect(fetches).toBe(0)
    })

    it('fetches latest, reports outdated and writes the cache', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0' }))
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.current).toBe('0.3.1')
        expect(result.latest).toBe('0.4.0')
        expect(result.outdated).toBe(true)
        expect(result.fromCache).toBe(false)
        const cached = JSON.parse(fs.readFileSync(path.join(home, '.cache/update-check.json'), 'utf8'))
        expect(cached.version).toBe('0.4.0')
        expect(cached.checkedAt).toBe(1_000_000)
    })

    it('does not flag outdated when current is already newer', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.2.0' }))
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.outdated).toBe(false)
    })

    it('refetches when the cache is stale and overwrites it', async () => {
        const home = makeTmpDir()
        fs.mkdirSync(path.join(home, '.cache'), { recursive: true })
        fs.writeFileSync(
            path.join(home, '.cache/update-check.json'),
            JSON.stringify({ version: '0.1.0', checkedAt: 1_000_000 - 86_400_000 - 1000 }),
        )
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0' }))
        })
        const result = await checkForUpdate({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            now: 1_000_000,
            ttlMs: 86_400_000,
            fetchImpl: fetchImpl(s.url),
        })
        expect(result.latest).toBe('0.4.0')
        expect(result.fromCache).toBe(false)
    })
})

describe('getAssetName', () => {
    it('maps platform and arch to release asset names', () => {
        expect(getAssetName({ platform: 'linux', arch: 'x64' })).toBe('meddle-linux-x64')
        expect(getAssetName({ platform: 'darwin', arch: 'arm64' })).toBe('meddle-darwin-arm64')
        expect(getAssetName({ platform: 'win32', arch: 'x64' })).toBe('meddle-windows-x64.exe')
        expect(getAssetName({ platform: 'win32', arch: 'arm64' })).toBe('meddle-windows-arm64.exe')
    })

    it('throws on unsupported platforms', () => {
        expect(() => getAssetName({ platform: 'freebsd', arch: 'x64' })).toThrow()
        expect(() => getAssetName({ platform: 'linux', arch: 'mips' })).toThrow()
    })
})

describe('downloadBinaryAsset', () => {
    const makeFixture = async () => {
        const payload = crypto.randomBytes(256)
        const hash = crypto.createHash('sha256').update(payload).digest('hex')
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                res.end(payload)
            } else if (req.url === '/v1.2.3/meddle-linux-x64.sha256') {
                res.end(`${hash}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        return { s, payload, hash }
    }

    it('downloads, verifies the checksum and atomically replaces the binary', async () => {
        const { s, payload, hash } = await makeFixture()
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')

        const result = await downloadBinaryAsset({
            version: '1.2.3',
            destFile,
            platform: 'linux',
            arch: 'x64',
            baseUrl: s.url,
        })

        expect(fs.readFileSync(destFile)).toEqual(payload)
        expect(fs.readFileSync(`${destFile}.bak`).toString()).toBe('old-binary')
        expect(result.installed).toBe(destFile)
        expect(result.backup).toBe(`${destFile}.bak`)
        expect(fs.statSync(destFile).mode & 0o111).not.toBe(0)
    })

    it('rejects on checksum mismatch and leaves the binary untouched', async () => {
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')
        const payload = crypto.randomBytes(64)
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                res.end(payload)
            } else if (req.url === '/v1.2.3/meddle-linux-x64.sha256') {
                res.end(`${'0'.repeat(64)}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        await expect(
            downloadBinaryAsset({
                version: '1.2.3',
                destFile,
                platform: 'linux',
                arch: 'x64',
                baseUrl: s.url,
            }),
        ).rejects.toThrow()
        expect(fs.readFileSync(destFile).toString()).toBe('old-binary')
        expect(fs.existsSync(`${destFile}.bak`)).toBe(false)
    })

    it('rejects when the checksum sidecar is missing', async () => {
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                res.end('payload')
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        await expect(
            downloadBinaryAsset({
                version: '1.2.3',
                destFile,
                platform: 'linux',
                arch: 'x64',
                baseUrl: s.url,
            }),
        ).rejects.toThrow()
        expect(fs.existsSync(destFile)).toBe(false)
    })

    it('retries the payload download when the first attempt fails mid-body', async () => {
        const { payload, hash } = await makeFixture()
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')

        let binaryAttempts = 0
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                binaryAttempts++
                if (binaryAttempts === 1) {
                    // Simulate a connection drop mid-body: headers then abort.
                    res.writeHead(200, { 'content-length': String(payload.length) })
                    res.write(payload.slice(0, 4))
                    res.destroy()
                    return
                }
                res.end(payload)
            } else if (req.url === '/v1.2.3/meddle-linux-x64.sha256') {
                res.end(`${hash}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })

        const result = await downloadBinaryAsset({
            version: '1.2.3',
            destFile,
            platform: 'linux',
            arch: 'x64',
            baseUrl: s.url,
            retries: 2,
            retryDelayMs: 0,
        })

        expect(binaryAttempts).toBe(2)
        expect(fs.readFileSync(destFile)).toEqual(payload)
        expect(result.installed).toBe(destFile)
    })

    it('retries when the first payload fetch fails with a network error', async () => {
        const { payload, hash } = await makeFixture()
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')

        let binaryAttempts = 0
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                binaryAttempts++
                if (binaryAttempts === 1) {
                    res.destroy(new Error('connection reset'))
                    return
                }
                res.end(payload)
            } else if (req.url === '/v1.2.3/meddle-linux-x64.sha256') {
                res.end(`${hash}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })

        const result = await downloadBinaryAsset({
            version: '1.2.3',
            destFile,
            platform: 'linux',
            arch: 'x64',
            baseUrl: s.url,
            retries: 2,
            retryDelayMs: 0,
        })

        expect(binaryAttempts).toBe(2)
        expect(fs.readFileSync(destFile)).toEqual(payload)
    })

    it('gives up after exhausting retries', async () => {
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')
        const payload = crypto.randomBytes(64)
        const hash = crypto.createHash('sha256').update(payload).digest('hex')
        let binaryAttempts = 0
        const s = await jsonServer((req, res) => {
            if (req.url === '/v1.2.3/meddle-linux-x64') {
                binaryAttempts++
                res.destroy(new Error('connection reset'))
            } else if (req.url === '/v1.2.3/meddle-linux-x64.sha256') {
                res.end(`${hash}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        await expect(
            downloadBinaryAsset({
                version: '1.2.3',
                destFile,
                platform: 'linux',
                arch: 'x64',
                baseUrl: s.url,
                retries: 2,
                retryDelayMs: 0,
            }),
        ).rejects.toThrow()
        expect(binaryAttempts).toBe(3) // 1 initial + 2 retries
        expect(fs.readFileSync(destFile).toString()).toBe('old-binary')
    })

    it('restores the backup and throws a clear error when the replace fails', async () => {
        const { s } = await makeFixture()
        const dir = makeTmpDir()
        const destFile = path.join(dir, 'meddle')
        fs.writeFileSync(destFile, 'old-binary')
        const fsImpl = {
            ...fs,
            renameSync: (from: string, to: string) => {
                if (from.includes('.tmp')) {
                    throw Object.assign(new Error('EPERM: running binary is locked'), { code: 'EPERM' })
                }
                return fs.renameSync(from, to)
            },
        }
        await expect(
            downloadBinaryAsset({
                version: '1.2.3',
                destFile,
                platform: 'linux',
                arch: 'x64',
                baseUrl: s.url,
                fsImpl,
            }),
        ).rejects.toThrow(/替换二进制失败/)
        expect(fs.readFileSync(destFile).toString()).toBe('old-binary')
        expect(fs.existsSync(`${destFile}.bak`)).toBe(false)
        expect(fs.readdirSync(dir).some((f) => f.includes('.tmp'))).toBe(false)
    })

    it('uses a generous timeout for the binary payload download', async () => {
        const { DEFAULT_DOWNLOAD_TIMEOUT_MS } = await import('../bin/lib/update-check')
        expect(DEFAULT_DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
    })
})

describe('auto-update setting', () => {
    it('defaults to disabled', () => {
        const home = makeTmpDir()
        expect(getAutoUpdate(home)).toBe(false)
    })

    it('persists the setting into settings.json preserving other keys', () => {
        const home = makeTmpDir()
        fs.mkdirSync(home, { recursive: true })
        fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ activeRuleFiles: ['dev'] }))
        setAutoUpdate(home, true)
        expect(getAutoUpdate(home)).toBe(true)
        const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))
        expect(settings.autoUpdate).toBe(true)
        expect(settings.activeRuleFiles).toEqual(['dev'])
    })

    it('can disable a previously enabled setting', () => {
        const home = makeTmpDir()
        setAutoUpdate(home, true)
        setAutoUpdate(home, false)
        expect(getAutoUpdate(home)).toBe(false)
    })

    it('env var MEDDLE_AUTO_UPDATE takes precedence', () => {
        const home = makeTmpDir()
        expect(getAutoUpdate(home)).toBe(false)
        process.env.MEDDLE_AUTO_UPDATE = '1'
        expect(getAutoUpdate(home)).toBe(true)
        process.env.MEDDLE_AUTO_UPDATE = 'false'
        expect(getAutoUpdate(home)).toBe(false)
    })
})

describe('runAsyncUpdateCheck', () => {
    it('notifies onOutdated when a newer version exists', async () => {
        const home = makeTmpDir()
        const s = await jsonServer((_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ version: '0.4.0' }))
        })
        let notified: unknown = null
        const result = runAsyncUpdateCheck({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            delayMs: 0,
            fetchImpl: fetchImpl(s.url),
            onOutdated: (info) => {
                notified = info
            },
        })
        expect(result).toBeUndefined()
        await waitFor(() => notified !== null)
        expect(notified).toMatchObject({ current: '0.3.1', latest: '0.4.0' })
    })

    it('never throws when the network fails', async () => {
        const home = makeTmpDir()
        let notified = 0
        let fetchCalled = false
        runAsyncUpdateCheck({
            home,
            installMethod: 'npm',
            current: '0.3.1',
            delayMs: 0,
            fetchImpl: async () => {
                fetchCalled = true
                throw new Error('network down')
            },
            onOutdated: () => {
                notified++
            },
        })
        await waitFor(() => fetchCalled)
        expect(notified).toBe(0)
    })

    it('auto-installs the binary when auto-update is enabled', async () => {
        const home = makeTmpDir()
        const binDir = path.join(home, 'bin')
        fs.mkdirSync(binDir, { recursive: true })
        setAutoUpdate(home, true)
        const payload = crypto.randomBytes(128)
        const hash = crypto.createHash('sha256').update(payload).digest('hex')
        const s = await jsonServer((req, res) => {
            if (req.url === '/JonathanLee-LX/meddle/releases/latest') {
                res.statusCode = 302
                res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/v0.4.0')
                res.end()
            } else if (req.url === '/JonathanLee-LX/meddle/releases/download/v0.4.0/meddle-linux-x64') {
                res.end(payload)
            } else if (req.url === '/JonathanLee-LX/meddle/releases/download/v0.4.0/meddle-linux-x64.sha256') {
                res.end(`${hash}  meddle-linux-x64\n`)
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        let notified: Record<string, unknown> = {}
        runAsyncUpdateCheck({
            home,
            installMethod: 'binary',
            current: '0.3.1',
            delayMs: 0,
            binDir,
            fetchImpl: fetchImpl(s.url),
            onOutdated: (info) => {
                notified = info
            },
        })
        await waitFor(() => notified.autoUpdated === true)
        expect(fs.readFileSync(path.join(binDir, 'meddle'))).toEqual(payload)
    })

    it('skips auto-download when the running executable differs from the install dir', async () => {
        const home = makeTmpDir()
        const binDir = path.join(home, 'bin')
        fs.mkdirSync(binDir, { recursive: true })
        setAutoUpdate(home, true)
        let downloadAttempted = false
        const s = await jsonServer((req, res) => {
            if (req.url === '/JonathanLee-LX/meddle/releases/latest') {
                res.statusCode = 302
                res.setHeader('location', '/JonathanLee-LX/meddle/releases/tag/v0.4.0')
                res.end()
            } else if (req.url && req.url.includes('releases/download')) {
                downloadAttempted = true
                res.statusCode = 404
                res.end()
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        let notified: Record<string, unknown> = {}
        runAsyncUpdateCheck({
            home,
            installMethod: 'binary',
            current: '0.3.1',
            delayMs: 0,
            binDir,
            execPath: '/custom/path/meddle',
            fetchImpl: fetchImpl(s.url),
            onOutdated: (info) => {
                notified = info
            },
        })
        await waitFor(() => notified.latest === '0.4.0')
        expect(downloadAttempted).toBe(false)
        expect(notified.autoUpdated).toBeUndefined()
    })
})

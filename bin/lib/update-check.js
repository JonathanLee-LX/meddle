/**
 * meddle update-check — version check + update download utilities.
 *
 * Pure JS so it runs unmodified in the npm package and in the deno-compiled
 * binary (bin/ is bundled at compile time). Network is injected via
 * `fetchImpl` so specs can point at local fixtures without touching the
 * real npm registry / GitHub.
 *
 * Version sources:
 *   - npm installs  → npm registry (https://registry.npmjs.org/@jonathanleeelx/meddle/latest)
 *   - binary installs → GitHub releases/latest redirect (same logic as scripts/install-binary.sh)
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { resolveMeddleHome } = require('./meddle-home')

const PACKAGE_NAME = '@jonathanleelx/meddle'
const REPO = 'JonathanLee-LX/meddle'
const DEFAULT_NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const DEFAULT_GITHUB_LATEST_URL = `https://github.com/${REPO}/releases/latest`
const DEFAULT_DOWNLOAD_BASE_URL = `https://github.com/${REPO}/releases/download`
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 5000

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Parse a semver-ish string. Returns { major, minor, patch, prerelease } or
 * null when the input is not a valid version.
 */
function parseVersion(value) {
    if (typeof value !== 'string') return null
    const m = VERSION_RE.exec(value.trim())
    if (!m) return null
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        prerelease: m[4] ? m[4].split('.') : [],
    }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidVersion(value) {
    return parseVersion(value) !== null
}

/**
 * Compare two semver strings. -1 when a < b, 0 when equal, 1 when a > b.
 * Prereleases sort before their release (0.4.0-beta.1 < 0.4.0).
 * @throws {Error} when either argument is not a valid version.
 */
function compareVersions(a, b) {
    const va = parseVersion(a)
    const vb = parseVersion(b)
    if (!va) throw new Error(`Invalid version: ${a}`)
    if (!vb) throw new Error(`Invalid version: ${b}`)

    const partsA = [va.major, va.minor, va.patch]
    const partsB = [vb.major, vb.minor, vb.patch]
    for (let i = 0; i < 3; i++) {
        if (partsA[i] !== partsB[i]) return partsA[i] < partsB[i] ? -1 : 1
    }

    if (va.prerelease.length === 0 && vb.prerelease.length === 0) return 0
    if (va.prerelease.length === 0) return 1
    if (vb.prerelease.length === 0) return -1

    const len = Math.max(va.prerelease.length, vb.prerelease.length)
    for (let i = 0; i < len; i++) {
        const pa = va.prerelease[i]
        const pb = vb.prerelease[i]
        if (pa === undefined) return -1
        if (pb === undefined) return 1
        const na = /^\d+$/.test(pa)
        const nb = /^\d+$/.test(pb)
        if (na && nb) {
            if (Number(pa) !== Number(pb)) return Number(pa) < Number(pb) ? -1 : 1
        } else if (na !== nb) {
            // numeric identifiers always sort below non-numeric ones
            return na ? -1 : 1
        } else if (pa !== pb) {
            return pa < pb ? -1 : 1
        }
    }
    return 0
}

/**
 * Fetch the latest version from the npm registry.
 * @param {{ fetchImpl?: Function, registryUrl?: string, timeoutMs?: number }} opts
 * @returns {Promise<string>}
 */
async function getLatestVersionNpm({ fetchImpl, registryUrl, timeoutMs } = {}) {
    const doFetch = fetchImpl || fetch
    const url = registryUrl || DEFAULT_NPM_REGISTRY_URL
    const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`npm registry responded ${response.status}`)
    const data = await response.json()
    const version = data && typeof data.version === 'string' ? data.version : ''
    if (!isValidVersion(version)) throw new Error(`npm registry returned no valid version`)
    return version
}

/**
 * Fetch the latest version from the GitHub releases/latest redirect.
 * @param {{ fetchImpl?: Function, latestUrl?: string, timeoutMs?: number }} opts
 * @returns {Promise<string>}
 */
async function getLatestVersionGithub({ fetchImpl, latestUrl, timeoutMs } = {}) {
    const doFetch = fetchImpl || fetch
    const url = latestUrl || DEFAULT_GITHUB_LATEST_URL
    const response = await doFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS),
    })
    if (response.status < 300 || response.status >= 400) {
        throw new Error(`GitHub latest release did not redirect (${response.status})`)
    }
    const location = response.headers.get('location') || ''
    const match = /\/tag\/(v?[\d][\w.-]*)$/.exec(location)
    if (!match) throw new Error(`Could not resolve latest release tag`)
    return match[1].replace(/^v/, '')
}

/**
 * Detect how meddle was installed.
 * npm → the module lives inside a node_modules directory.
 * binary → deno-compiled binary (bin/ bundled inside the executable).
 * @param {{ moduleDir: string }} opts
 * @returns {'npm' | 'binary'}
 */
function getInstallMethod({ moduleDir }) {
    return /[\\/]node_modules[\\/]/.test(moduleDir) ? 'npm' : 'binary'
}

/**
 * @param {string} home meddle home directory
 * @returns {string} path of the update check cache file
 */
function updateCachePath(home) {
    return path.join(home, '.cache', 'update-check.json')
}

/**
 * @param {{ home: string, fetchImpl?: Function, installMethod: string, current: string,
 *           now?: number, ttlMs?: number, force?: boolean,
 *           registryUrl?: string, latestUrl?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ current: string, latest: string, outdated: boolean, fromCache: boolean, checkedAt: number }>}
 */
async function checkForUpdate(opts) {
    const {
        home,
        installMethod,
        current,
        now = Date.now(),
        ttlMs = DEFAULT_CACHE_TTL_MS,
        force = false,
        fetchImpl,
        registryUrl,
        latestUrl,
        timeoutMs,
    } = opts

    const cacheFile = updateCachePath(home)
    let cached = null
    try {
        cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    } catch (_) {}

    if (!force && cached && typeof cached.version === 'string' && typeof cached.checkedAt === 'number') {
        if (now - cached.checkedAt < ttlMs) {
            return {
                current,
                latest: cached.version,
                outdated: compareVersions(cached.version, current) > 0,
                fromCache: true,
                checkedAt: cached.checkedAt,
            }
        }
    }

    const latest = installMethod === 'binary'
        ? await getLatestVersionGithub({ fetchImpl, latestUrl, timeoutMs })
        : await getLatestVersionNpm({ fetchImpl, registryUrl, timeoutMs })

    const checkedAt = now
    try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
        fs.writeFileSync(cacheFile, JSON.stringify({ version: latest, checkedAt }), 'utf8')
    } catch (_) {}

    return {
        current,
        latest,
        outdated: compareVersions(latest, current) > 0,
        fromCache: false,
        checkedAt,
    }
}

/**
 * Map platform/arch to the GitHub release asset name.
 * @param {{ platform: string, arch: string }} opts
 * @returns {string}
 */
function getAssetName({ platform, arch }) {
    let osTag
    switch (platform) {
        case 'linux': osTag = 'linux'; break
        case 'darwin': osTag = 'darwin'; break
        case 'win32': osTag = 'windows'; break
        default: throw new Error(`unsupported platform: ${platform}`)
    }
    let archTag
    switch (arch) {
        case 'x64': case 'amd64': archTag = 'x64'; break
        case 'arm64': case 'aarch64': archTag = 'arm64'; break
        default: throw new Error(`unsupported arch: ${arch}`)
    }
    const ext = platform === 'win32' ? '.exe' : ''
    return `meddle-${osTag}-${archTag}${ext}`
}

function sha256Hex(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Download a release binary, verify its SHA256 sidecar and atomically replace
 * the existing binary. The previous binary is kept as `<destFile>.bak`.
 * @param {{ version: string, destFile: string, platform: string, arch: string,
 *           baseUrl?: string, fetchImpl?: Function, timeoutMs?: number }} opts
 * @returns {Promise<{ installed: string, backup: string, version: string }>}
 */
async function downloadBinaryAsset(opts) {
    const { version, destFile, platform, arch } = opts
    const baseUrl = opts.baseUrl || DEFAULT_DOWNLOAD_BASE_URL
    const doFetch = opts.fetchImpl || fetch
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS

    const asset = getAssetName({ platform, arch })
    const assetUrl = `${baseUrl}/v${version}/${asset}`
    const shaUrl = `${assetUrl}.sha256`

    const [binaryResponse, shaResponse] = await Promise.all([
        doFetch(assetUrl, { signal: AbortSignal.timeout(timeoutMs) }),
        doFetch(shaUrl, { signal: AbortSignal.timeout(timeoutMs) }),
    ])
    if (!binaryResponse.ok) throw new Error(`download failed (${binaryResponse.status})`)
    if (!shaResponse.ok) throw new Error(`checksum sidecar missing (${shaResponse.status})`)

    const payload = Buffer.from(await binaryResponse.arrayBuffer())
    const shaText = await shaResponse.text()
    const expected = shaText.trim().split(/\s+/)[0]
    if (!/^[0-9a-f]{64}$/i.test(expected)) throw new Error(`invalid checksum sidecar`)
    if (sha256Hex(payload) !== expected.toLowerCase()) {
        throw new Error(`checksum mismatch for ${asset}`)
    }

    const dir = path.dirname(destFile)
    fs.mkdirSync(dir, { recursive: true })

    const tmpFile = `${destFile}.tmp-${process.pid}`
    fs.writeFileSync(tmpFile, payload)
    if (platform !== 'win32') fs.chmodSync(tmpFile, 0o755)

    const backup = `${destFile}.bak`
    try {
        if (fs.existsSync(backup)) fs.unlinkSync(backup)
        if (fs.existsSync(destFile)) fs.renameSync(destFile, backup)
    } catch (_) {}
    try {
        fs.renameSync(tmpFile, destFile)
    } catch (err) {
        fs.unlinkSync(tmpFile)
        throw err
    }

    return { installed: destFile, backup: fs.existsSync(backup) ? backup : null, version }
}

/**
 * Read the auto-update setting. Precedence: MEDDLE_AUTO_UPDATE env var
 * (when set) → settings.json `autoUpdate` (default false).
 * @param {string} home
 * @returns {boolean}
 */
function getAutoUpdate(home) {
    const env = process.env.MEDDLE_AUTO_UPDATE
    if (env !== undefined && env !== '') {
        return env === '1' || env.toLowerCase() === 'true'
    }
    try {
        const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))
        return settings.autoUpdate === true
    } catch (_) {
        return false
    }
}

/**
 * Persist the auto-update setting into settings.json, preserving other keys.
 * @param {string} home
 * @param {boolean} value
 */
function setAutoUpdate(home, value) {
    const settingsPath = path.join(home, 'settings.json')
    let settings = {}
    try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch (_) {}
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {}
    settings.autoUpdate = value === true
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

function printUpdateNotice(info) {
    const channel = process.env.MEDDLE_UPDATE_SILENT ? undefined : console
    if (!channel) return
    if (info.autoUpdated) {
        channel.log(`\n[meddle] 已自动升级到 ${info.latest}（重启 meddle 后生效）`)
        return
    }
    channel.log(
        `\n[meddle] 发现新版本 ${info.latest}（当前 ${info.current}），运行 "meddle update" 升级`
    )
}

/**
 * Fire-and-forget startup check. Never blocks, never throws, never keeps the
 * process alive. When auto-update is enabled (binary installs) the new binary
 * is downloaded and verified on disk; npm installs only get a notice.
 * @param {{ home?: string, installMethod?: string, current: string,
 *           binDir?: string, delayMs?: number, fetchImpl?: Function,
 *           onOutdated?: Function }} opts
 * @returns {void}
 */
function runAsyncUpdateCheck(opts) {
    const home = opts.home || resolveMeddleHome()
    const installMethod = opts.installMethod || getInstallMethod({ moduleDir: __dirname })
    const binDir = opts.binDir || process.env.MEDDLE_BIN_DIR || path.join(home, 'bin')
    const delayMs = opts.delayMs === undefined ? 1500 : opts.delayMs

    const timer = setTimeout(() => {
        ;(async () => {
            const info = await checkForUpdate({
                home,
                installMethod,
                current: opts.current,
                fetchImpl: opts.fetchImpl,
            })
            if (!info.outdated) return
            let finalInfo = info
            if (getAutoUpdate(home) && installMethod === 'binary') {
                const destFile = path.join(binDir, os.platform() === 'win32' ? 'meddle.exe' : 'meddle')
                try {
                    await downloadBinaryAsset({
                        version: info.latest,
                        destFile,
                        platform: os.platform(),
                        arch: os.arch(),
                        baseUrl: opts.baseUrl,
                        fetchImpl: opts.fetchImpl,
                    })
                    finalInfo = { ...info, autoUpdated: true, destFile }
                } catch (err) {
                    finalInfo = { ...info, autoUpdateFailed: err && err.message ? err.message : String(err) }
                }
            }
            if (opts.onOutdated) {
                opts.onOutdated(finalInfo)
            } else {
                printUpdateNotice(finalInfo)
            }
        })().catch(() => {})
    }, delayMs)

    if (typeof timer.unref === 'function') timer.unref()
}

module.exports = {
    compareVersions,
    isValidVersion,
    parseVersion,
    getLatestVersionNpm,
    getLatestVersionGithub,
    getInstallMethod,
    checkForUpdate,
    getAssetName,
    downloadBinaryAsset,
    getAutoUpdate,
    setAutoUpdate,
    runAsyncUpdateCheck,
}

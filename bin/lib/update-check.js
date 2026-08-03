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
const DEFAULT_NPM_BETA_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/beta`
const DEFAULT_GITHUB_LATEST_URL = `https://github.com/${REPO}/releases/latest`
const DEFAULT_DOWNLOAD_BASE_URL = `https://github.com/${REPO}/releases/download`
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120 * 1000

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
 * @param {{ fetchImpl?: Function, registryUrl?: string, timeoutMs?: number, distTag?: string }} opts
 * @returns {Promise<string>}
 */
async function getLatestVersionNpm({ fetchImpl, registryUrl, timeoutMs, distTag } = {}) {
    const doFetch = fetchImpl || fetch
    const url = registryUrl
        || (distTag === 'beta'
            ? (process.env.MEDDLE_NPM_BETA_REGISTRY_URL || process.env.MEDDLE_NPM_REGISTRY_URL || DEFAULT_NPM_BETA_URL)
            : (process.env.MEDDLE_NPM_REGISTRY_URL || DEFAULT_NPM_REGISTRY_URL))
    const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`npm registry responded ${response.status}`)
    const data = await response.json()
    const version = data && typeof data.version === 'string' ? data.version : ''
    if (!isValidVersion(version)) throw new Error(`npm registry returned no valid version`)
    return version
}

/**
 * Fetch the latest stable version from the GitHub releases/latest redirect
 * (prereleases are excluded by GitHub). Beta versions resolve through the npm
 * registry `beta` dist-tag instead — see checkForUpdate.
 * @param {{ fetchImpl?: Function, latestUrl?: string, timeoutMs?: number }} opts
 * @returns {Promise<string>}
 */
async function getLatestVersionGithub({ fetchImpl, latestUrl, timeoutMs } = {}) {
    const doFetch = fetchImpl || fetch
    const url = latestUrl || process.env.MEDDLE_GITHUB_LATEST_URL || DEFAULT_GITHUB_LATEST_URL
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
 * Infer the update channel from the current version: prerelease versions
 * (e.g. 0.4.0-beta.4) default to the beta channel, releases to stable.
 * @param {string} current
 * @returns {'stable' | 'beta'}
 */
function inferChannel(current) {
    return isValidVersion(current) && parseVersion(current).prerelease.length > 0 ? 'beta' : 'stable'
}

/**
 * Decide whether the install should move to `latest`. Explicit channel flags
 * (--beta/--stable) mean "switch channels", so a different channel always
 * triggers the move (even a downgrade); the inferred channel only upgrades.
 * @param {{ latest: string, current: string, channel: string, explicitChannel: boolean }} opts
 * @returns {boolean}
 */
function outdatedByChannel({ latest, current, channel, explicitChannel }) {
    if (explicitChannel && channel !== inferChannel(current)) return true
    return compareVersions(latest, current) > 0
}

/**
 * @param {{ home: string, fetchImpl?: Function, installMethod: string, current: string,
 *           now?: number, ttlMs?: number, force?: boolean,
 *           registryUrl?: string, latestUrl?: string, timeoutMs?: number,
 *           channel?: string, explicitChannel?: boolean }} opts
 * @returns {Promise<{ current: string, latest: string, outdated: boolean, fromCache: boolean, checkedAt: number, channel: string }>}
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
        channel = inferChannel(current),
        explicitChannel = false,
    } = opts

    const cacheFile = updateCachePath(home)
    let cached = null
    try {
        cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    } catch (_) {}

    if (!force && cached && typeof cached.version === 'string' && typeof cached.checkedAt === 'number'
        && (cached.channel || 'stable') === channel) {
        if (now - cached.checkedAt < ttlMs) {
            return {
                current,
                latest: cached.version,
                outdated: outdatedByChannel({ latest: cached.version, current, channel, explicitChannel }),
                fromCache: true,
                checkedAt: cached.checkedAt,
                channel,
            }
        }
    }

    // Beta channel always resolves via the npm registry `beta` dist-tag — the
    // GitHub releases API is rate-limited (403) for unauthenticated callers.
    // Binary installs still download assets from GitHub, but resolve the
    // version number from npm where it is published in lockstep with releases.
    const latest = channel === 'beta'
        ? await getLatestVersionNpm({ fetchImpl, registryUrl, timeoutMs, distTag: 'beta' })
        : installMethod === 'binary'
            ? await getLatestVersionGithub({ fetchImpl, latestUrl, timeoutMs })
            : await getLatestVersionNpm({ fetchImpl, registryUrl, timeoutMs })

    const checkedAt = now
    try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
        fs.writeFileSync(cacheFile, JSON.stringify({ version: latest, checkedAt, channel }), 'utf8')
    } catch (_) {}

    return {
        current,
        latest,
        outdated: outdatedByChannel({ latest, current, channel, explicitChannel }),
        fromCache: false,
        checkedAt,
        channel,
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
 * the existing binary. The previous binary is kept as `<destFile>.bak`. When
 * the final replace fails the backup is restored and a descriptive error is
 * thrown (Windows commonly fails with EPERM on a running binary).
 *
 * The payload download is retried (default 3 attempts) because binaries are
 * large (100MB+) and flaky connections drop mid-body. Progress is reported
 * via `onProgress` while streaming (received/total bytes), and `onAttempt`
 * fires before each attempt (skipping retries is visible to callers).
 * @param {{ version: string, destFile: string, platform: string, arch: string,
 *           baseUrl?: string, fetchImpl?: Function, timeoutMs?: number,
 *           retries?: number, retryDelayMs?: number,
 *           onProgress?: Function, onAttempt?: Function,
 *           fsImpl?: object }} opts
 * @returns {Promise<{ installed: string, backup: string, version: string }>}
 */
async function downloadBinaryAsset(opts) {
    const { version, destFile, platform, arch } = opts
    const baseUrl = opts.baseUrl || process.env.MEDDLE_UPDATE_BASE_URL || DEFAULT_DOWNLOAD_BASE_URL
    const doFetch = opts.fetchImpl || fetch
    const fsImpl = opts.fsImpl || fs
    const payloadTimeout = opts.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS
    const maxRetries = opts.retries === undefined ? 3 : opts.retries
    const retryDelayMs = opts.retryDelayMs === undefined ? 1000 : opts.retryDelayMs
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
    const onAttempt = typeof opts.onAttempt === 'function' ? opts.onAttempt : () => {}

    const asset = getAssetName({ platform, arch })
    const assetUrl = `${baseUrl}/v${version}/${asset}`
    const shaUrl = `${assetUrl}.sha256`

    // The binary is large (100MB+); the checksum sidecar is tiny. Use an IDLE
    // timeout for the payload (reset on every received chunk — a slow-but-steady
    // transfer is never killed by a total wall-time budget) and the regular
    // timeout for the metadata fetch.
    const fetchPayload = async () => {
        let lastError = null
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            if (attempt > 1 && retryDelayMs > 0) {
                await new Promise((r) => setTimeout(r, retryDelayMs * (attempt - 1)))
            }
            onAttempt(attempt, maxRetries + 1)
            let idleTimer = null
            const controller = new AbortController()
            const resetIdle = () => {
                if (idleTimer) clearTimeout(idleTimer)
                idleTimer = setTimeout(() => {
                    controller.abort(new Error('download stalled (idle timeout)'))
                }, payloadTimeout)
                if (typeof idleTimer.unref === 'function') idleTimer.unref()
            }
            resetIdle()
            try {
                const response = await doFetch(assetUrl, { signal: controller.signal })
                if (!response.ok) throw new Error(`download failed (${response.status})`)
                const total = Number(response.headers.get('content-length')) || 0
                const chunks = []
                let received = 0
                if (response.body && typeof response.body.getReader === 'function') {
                    const reader = response.body.getReader()
                    for (;;) {
                        resetIdle()
                        const { done, value } = await reader.read()
                        if (done) break
                        chunks.push(Buffer.from(value))
                        received += value.byteLength
                        onProgress({ received, total })
                    }
                } else {
                    resetIdle()
                    const buf = Buffer.from(await response.arrayBuffer())
                    chunks.push(buf)
                    received = buf.length
                    onProgress({ received, total })
                }
                if (idleTimer) clearTimeout(idleTimer)
                return Buffer.concat(chunks)
            } catch (err) {
                if (idleTimer) clearTimeout(idleTimer)
                lastError = err
                if (attempt > maxRetries) break
            }
        }
        throw lastError || new Error(`download failed for ${assetUrl}`)
    }

    const shaResponse = await doFetch(shaUrl, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
    if (!shaResponse.ok) throw new Error(`checksum sidecar missing (${shaResponse.status})`)

    const payload = await fetchPayload()
    const shaText = await shaResponse.text()
    const expected = shaText.trim().split(/\s+/)[0]
    if (!/^[0-9a-f]{64}$/i.test(expected)) throw new Error(`invalid checksum sidecar`)
    if (sha256Hex(payload) !== expected.toLowerCase()) {
        throw new Error(`checksum mismatch for ${asset}`)
    }

    const dir = path.dirname(destFile)
    fsImpl.mkdirSync(dir, { recursive: true })

    const tmpFile = `${destFile}.tmp-${process.pid}`
    fsImpl.writeFileSync(tmpFile, payload)
    if (platform !== 'win32') fsImpl.chmodSync(tmpFile, 0o755)

    const backup = `${destFile}.bak`
    try {
        if (fsImpl.existsSync(backup)) fsImpl.unlinkSync(backup)
        if (fsImpl.existsSync(destFile)) fsImpl.renameSync(destFile, backup)
    } catch (_) {}
    try {
        fsImpl.renameSync(tmpFile, destFile)
    } catch (err) {
        try {
            if (fsImpl.existsSync(backup) && !fsImpl.existsSync(destFile)) {
                fsImpl.renameSync(backup, destFile)
            }
        } catch (_) {}
        try { fsImpl.unlinkSync(tmpFile) } catch (_) {}
        const hint = process.platform === 'win32'
            ? 'Windows 下无法替换运行中的 meddle.exe，请先停止 meddle 再运行 meddle update'
            : '替换二进制失败，请检查文件权限'
        throw new Error(`${hint}: ${(err && err.code) || (err && err.message) || err}`)
    }

    return { installed: destFile, backup: fsImpl.existsSync(backup) ? backup : null, version }
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
 * Resolve where `meddle update` should install the new binary.
 *   1. MEDDLE_BIN_DIR env (explicit override)
 *   2. the directory of the RUNNING binary — in-place updates, so installs on
 *      legacy (~/.meddle/bin) or custom paths stay where they are
 *   3. <home>/bin fallback (npm installs / no running binary)
 * @param {{ home: string, execPath?: string, platform?: string }} opts
 * @returns {string}
 */
function resolveUpdateBinDir({ home, execPath = process.execPath, platform = os.platform() } = {}) {
    if (process.env.MEDDLE_BIN_DIR) return process.env.MEDDLE_BIN_DIR
    const p = platform === 'win32' ? path.win32 : path
    const exeName = p.basename(execPath).toLowerCase()
    const expected = platform === 'win32' ? 'meddle.exe' : 'meddle'
    if (exeName === expected) return p.dirname(execPath)
    return p.join(home, 'bin')
}

/**
 * Fire-and-forget startup check. Never blocks, never throws, never keeps the
 * process alive. When auto-update is enabled (binary installs) the new binary
 * is downloaded and verified on disk — but only when the running executable
 * actually matches the install dir, otherwise the download would land where it
 * can never take effect. npm installs only get a notice.
 * @param {{ home?: string, installMethod?: string, current: string,
 *           binDir?: string, execPath?: string, delayMs?: number,
 *           fetchImpl?: Function, onOutdated?: Function }} opts
 * @returns {void}
 */
function resolveRealPath(p) {
    try { return fs.realpathSync(p) } catch (_) { return path.resolve(p) }
}

function isSameBinary(a, b) {
    return resolveRealPath(a) === resolveRealPath(b)
}

function runAsyncUpdateCheck(opts) {
    const home = opts.home || resolveMeddleHome()
    const installMethod = opts.installMethod || getInstallMethod({ moduleDir: __dirname })
    const binDir = opts.binDir || resolveUpdateBinDir({ home, execPath: opts.execPath || process.execPath })
    const delayMs = opts.delayMs === undefined ? 1500 : opts.delayMs
    const execPath = opts.execPath || process.execPath
    const exeBase = path.basename(execPath).toLowerCase()
    const isMeddleExecutable = exeBase === 'meddle' || exeBase === 'meddle.exe'

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
                if (isMeddleExecutable && !isSameBinary(destFile, execPath)) {
                    finalInfo = {
                        ...info,
                        skipAutoUpdate: '安装路径与当前运行路径不一致，跳过自动更新',
                    }
                } else {
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
    inferChannel,
    getLatestVersionNpm,
    getLatestVersionGithub,
    getInstallMethod,
    checkForUpdate,
    getAssetName,
    downloadBinaryAsset,
    getAutoUpdate,
    setAutoUpdate,
    resolveUpdateBinDir,
    runAsyncUpdateCheck,
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
}

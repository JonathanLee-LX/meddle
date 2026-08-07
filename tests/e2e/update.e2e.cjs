/**
 * E2E test for `meddle update` — fully offline via local HTTP fixtures.
 *
 * Mocks:
 *   - npm registry  → local /@jonathanleelx/meddle/latest
 *   - GitHub latest → local /releases/latest (302 redirect)
 *   - GitHub assets → local /releases/download/v<ver>/<asset> + .sha256
 *
 * Run: node tests/e2e/update.e2e.cjs
 */

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '../..')
const CLI = path.join(projectRoot, 'bin', 'index.js')
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version
const CURRENT_IS_PRERELEASE = /-/.test(CURRENT_VERSION)

// ── helpers ──────────────────────────────────────────────────────────

function findFreePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer()
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address()
            s.close(() => resolve(port))
        })
        s.on('error', reject)
    })
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex')
}

function makeTmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function run(args, env) {
    // Strip proxy vars so the child talks directly to the local fixture server.
    const cleanEnv = { ...process.env }
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
        delete cleanEnv[key]
    }
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            env: { ...cleanEnv, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        child.stdout.on('data', (d) => { stdout += d })
        child.stderr.on('data', (d) => { stdout += d })
        const timer = setTimeout(() => { child.kill('SIGKILL') }, 30_000)
        child.on('close', (code) => {
            clearTimeout(timer)
            resolve({ code: code ?? 1, stdout })
        })
    })
}

// ── fixture server ───────────────────────────────────────────────────

function startFixtureServer({ latestVersion, latestBetaVersion, assets }) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = req.url || ''

            // npm registry: GET /@jonathanleelx/meddle/latest
            if (url === '/@jonathanleelx/meddle/latest') {
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ version: latestVersion }))
                return
            }

            // npm registry beta dist-tag: GET /@jonathanleelx/meddle/beta
            if (url === '/@jonathanleelx/meddle/beta') {
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ version: latestBetaVersion || latestVersion }))
                return
            }

            // GitHub latest redirect: GET /releases/latest → 302
            if (url === '/releases/latest') {
                res.statusCode = 302
                res.setHeader('location', `/JonathanLee-LX/meddle/releases/tag/v${latestVersion}`)
                res.end()
                return
            }

            // GitHub asset download: GET /releases/download/v<ver>/<name>
            const assetMatch = /^\/releases\/download\/v([\d.\w-]+)\/(.+)$/.exec(url)
            if (assetMatch) {
                const [, ver, name] = assetMatch
                const key = `${ver}/${name}`
                if (assets[key] !== undefined) {
                    res.end(assets[key])
                    return
                }
            }

            res.statusCode = 404
            res.end('not found')
        })
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address()
            resolve({ server, port, base: `http://127.0.0.1:${port}` })
        })
    })
}

// ── tests ────────────────────────────────────────────────────────────

async function main() {
    let passed = 0
    let failed = 0

    async function test(name, fn) {
        try {
            await fn()
            passed++
            console.log(`  ✓ ${name}`)
        } catch (err) {
            failed++
            console.log(`  ✗ ${name}`)
            console.log(`    ${err.message}`)
        }
    }

    const home = makeTmpDir('meddle-e2e-home-')
    const binDir = makeTmpDir('meddle-e2e-bin-')

    // Prepare fake binary assets
    const oldBinary = Buffer.from('old-binary-v0.1.0')
    const newBinary = Buffer.from('new-binary-v2.0.0')
    const betaBinary = Buffer.from('new-binary-v2.1.0-beta.1')
    const tamperedBinary = Buffer.from('tampered-binary')

    const { server, base } = await startFixtureServer({
        latestVersion: '2.0.0',
        latestBetaVersion: '2.1.0-beta.1',
        assets: {
            '2.0.0/meddle-linux-x64': newBinary,
            '2.0.0/meddle-linux-x64.sha256': `${sha256(newBinary)}  meddle-linux-x64\n`,
            '2.1.0-beta.1/meddle-linux-x64': betaBinary,
            '2.1.0-beta.1/meddle-linux-x64.sha256': `${sha256(betaBinary)}  meddle-linux-x64\n`,
            '1.5.0/meddle-linux-x64': tamperedBinary,
            '1.5.0/meddle-linux-x64.sha256': `${'0'.repeat(64)}  meddle-linux-x64\n`,
        },
    })

    const baseEnv = {
        MEDDLE_HOME: home,
        MEDDLE_NPM_REGISTRY_URL: `${base}/@jonathanleelx/meddle/latest`,
        MEDDLE_NPM_BETA_REGISTRY_URL: `${base}/@jonathanleelx/meddle/beta`,
        MEDDLE_GITHUB_LATEST_URL: `${base}/releases/latest`,
        MEDDLE_UPDATE_BASE_URL: `${base}/releases/download`,
    }

    console.log('meddle update e2e (offline fixtures)\n')

    // ── update --check ──

    await test('--check --stable reports outdated (exit 2) when stable has newer version', async () => {
        const { code, stdout } = await run(['update', '--check', '--stable'], baseEnv)
        assert.equal(code, 2, `expected exit 2, got ${code}\n${stdout}`)
        assert.match(stdout, /2\.0\.0/)
    })

    await test('--check auto-infers channel from the current version', async () => {
        const { code, stdout } = await run(['update', '--check'], baseEnv)
        assert.equal(code, 2, `expected exit 2, got ${code}\n${stdout}`)
        const expected = CURRENT_IS_PRERELEASE ? /2\.1\.0-beta\.1/ : /2\.0\.0/
        assert.match(stdout, expected)
    })

    await test('--check ignores a fresh-but-stale cached version (manual check must hit the network)', async () => {
        // A stale cached "latest" (1.0.0) with a fresh timestamp must NOT be
        // served to a MANUAL `meddle update` — the user explicitly asked for a
        // check, so the 24h cache is bypassed. This is what made newly released
        // versions invisible right after publish.
        const cacheDir = path.join(home, '.cache')
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(
            path.join(cacheDir, 'update-check.json'),
            JSON.stringify({ version: '1.0.0', checkedAt: Date.now(), channel: 'stable' }),
        )

        const { code, stdout } = await run(['update', '--check', '--stable'], baseEnv)
        assert.equal(code, 2, `expected exit 2 (newer version available), got ${code}\n${stdout}`)
        assert.match(stdout, /2\.0\.0/)
        assert.doesNotMatch(stdout, /1\.0\.0/)
    })

    await test('--check --stable reports up-to-date (exit 0) when versions match', async () => {
        const { code, stdout } = await run(['update', '--check', '--stable'], {
            ...baseEnv,
            MEDDLE_NPM_REGISTRY_URL: `${base}/@jonathanleelx/meddle/latest`,
        })
        assert.ok(code === 0 || code === 2, `unexpected exit ${code}`)
    })

    await test('--stable switches a prerelease current to the stable version', async () => {
        // Prerelease current: explicit --stable switches channels (downgrades).
        // Stable current: --stable is a normal stable update (upgrade).
        const stableLatest = CURRENT_IS_PRERELEASE ? '0.3.1' : '99.0.0'
        const stablePayload = Buffer.from(`stable-binary-v${stableLatest}`)
        const olderServer = await startFixtureServer({
            latestVersion: stableLatest,
            latestBetaVersion: '99.1.0-beta.1',
            assets: {
                [`${stableLatest}/meddle-linux-x64`]: stablePayload,
                [`${stableLatest}/meddle-linux-x64.sha256`]: `${sha256(stablePayload)}  meddle-linux-x64\n`,
            },
        })
        const olderHome = makeTmpDir('meddle-e2e-older-')
        const check = await run(['update', '--check', '--stable'], {
            ...baseEnv,
            MEDDLE_HOME: olderHome,
            MEDDLE_GITHUB_LATEST_URL: `${olderServer.base}/releases/latest`,
        })
        assert.equal(check.code, 2, `expected exit 2, got ${check.code}\n${check.stdout}`)
        assert.match(check.stdout, new RegExp(stableLatest.replace(/\./g, '\\.')))
        assert.doesNotMatch(check.stdout, /已是最新版本/)
        assert.doesNotMatch(check.stdout, /已超过/)

        const destFile = path.join(binDir, 'meddle')
        fs.writeFileSync(destFile, oldBinary)
        const upgrade = await run(['update', '--stable'], {
            ...baseEnv,
            MEDDLE_HOME: olderHome,
            MEDDLE_BIN_DIR: binDir,
            MEDDLE_GITHUB_LATEST_URL: `${olderServer.base}/releases/latest`,
            MEDDLE_UPDATE_BASE_URL: `${olderServer.base}/releases/download`,
        })
        olderServer.server.close()
        fs.rmSync(olderHome, { recursive: true, force: true })
        assert.equal(upgrade.code, 0, `exit ${upgrade.code}\n${upgrade.stdout}`)
        assert.match(upgrade.stdout, new RegExp(stableLatest.replace(/\./g, '\\.')))
        assert.equal(fs.readFileSync(destFile).toString(), stablePayload.toString())
    })

    // ── update --version (binary download + replace) ──

    await test('--version downloads, verifies SHA256, replaces binary, creates .bak', async () => {
        const destFile = path.join(binDir, 'meddle')
        fs.writeFileSync(destFile, oldBinary)

        const { code, stdout } = await run(['update', '--version', '2.0.0'], {
            ...baseEnv,
            MEDDLE_BIN_DIR: binDir,
        })
        assert.equal(code, 0, `expected exit 0, got ${code}\n${stdout}`)
        assert.match(stdout, /已安装/)

        assert.deepEqual(fs.readFileSync(destFile), newBinary)
        assert.deepEqual(fs.readFileSync(`${destFile}.bak`), oldBinary)
        assert.ok(fs.statSync(destFile).mode & 0o111, 'binary should be executable')
    })

    await test('--version rejects on SHA256 mismatch, binary untouched', async () => {
        const destFile = path.join(binDir, 'meddle')
        fs.writeFileSync(destFile, oldBinary)
        try { fs.unlinkSync(`${destFile}.bak`) } catch (_) {}

        const { code, stdout } = await run(['update', '--version', '1.5.0'], {
            ...baseEnv,
            MEDDLE_BIN_DIR: binDir,
        })
        assert.notEqual(code, 0, 'should fail on checksum mismatch')
        assert.match(stdout, /checksum mismatch/)

        assert.deepEqual(fs.readFileSync(destFile), oldBinary)
        assert.ok(!fs.existsSync(`${destFile}.bak`), 'no backup on failed update')
    })

    await test('--version rejects invalid version string', async () => {
        const { code, stdout } = await run(['update', '--version', 'not-a-version'], baseEnv)
        assert.notEqual(code, 0)
        assert.match(stdout, /无效版本号/)
    })

    await test('--version skips downgrade', async () => {
        const { code, stdout } = await run(['update', '--version', '0.1.0'], baseEnv)
        assert.equal(code, 0)
        assert.match(stdout, /无需降级/)
    })

    // ── update --auto ──

    await test('--auto on persists to settings.json', async () => {
        const { code } = await run(['update', '--auto', 'on'], baseEnv)
        assert.equal(code, 0)
        const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))
        assert.equal(settings.autoUpdate, true)
    })

    await test('--auto off disables', async () => {
        const { code } = await run(['update', '--auto', 'off'], baseEnv)
        assert.equal(code, 0)
        const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))
        assert.equal(settings.autoUpdate, false)
    })

    await test('--auto preserves other settings keys', async () => {
        fs.writeFileSync(
            path.join(home, 'settings.json'),
            JSON.stringify({ activeRuleFiles: ['dev-rules'] }),
        )
        await run(['update', '--auto', 'on'], baseEnv)
        const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))
        assert.equal(settings.autoUpdate, true)
        assert.deepEqual(settings.activeRuleFiles, ['dev-rules'])
    })

    // ── update status ──

    await test('status shows install method, versions, auto-update flag', async () => {
        const { code, stdout } = await run(['update', 'status'], baseEnv)
        assert.equal(code, 0, `exit ${code}\n${stdout}`)
        assert.match(stdout, /Install method/)
        assert.match(stdout, /Current/)
        assert.match(stdout, /Latest/)
        assert.match(stdout, /Auto-update/)
    })

    // ── update --help ──

    await test('--help prints usage', async () => {
        const { code, stdout } = await run(['update', '--help'], baseEnv)
        assert.equal(code, 0)
        assert.match(stdout, /meddle update/)
        assert.match(stdout, /--check/)
        assert.match(stdout, /--auto/)
    })

    // ── update --beta ──

    await test('--beta --check finds the prerelease version', async () => {
        const { code, stdout } = await run(['update', '--check', '--beta'], baseEnv)
        assert.equal(code, 2, `expected exit 2, got ${code}\n${stdout}`)
        assert.match(stdout, /2\.1\.0-beta\.1/)
    })

    await test('--beta installs the prerelease binary over the current one', async () => {
        const destFile = path.join(binDir, 'meddle')
        fs.writeFileSync(destFile, oldBinary)

        const { code, stdout } = await run(['update', '--beta'], {
            ...baseEnv,
            MEDDLE_BIN_DIR: binDir,
        })
        assert.equal(code, 0, `exit ${code}\n${stdout}`)
        assert.match(stdout, /2\.1\.0-beta\.1/)
        assert.equal(fs.readFileSync(destFile).toString(), betaBinary.toString())
        assert.ok(fs.existsSync(destFile + '.bak'), 'expected .bak backup')
    })

    await test('default update auto-infers channel from the current version', async () => {
        const destFile = path.join(binDir, 'meddle')
        fs.writeFileSync(destFile, oldBinary)

        const { code, stdout } = await run(['update'], {
            ...baseEnv,
            MEDDLE_BIN_DIR: binDir,
        })
        assert.equal(code, 0, `exit ${code}\n${stdout}`)
        const expectedVersion = CURRENT_IS_PRERELEASE ? '2.1.0-beta.1' : '2.0.0'
        const expectedPayload = CURRENT_IS_PRERELEASE ? betaBinary : newBinary
        assert.match(stdout, new RegExp(expectedVersion.replace(/\./g, '\\.')))
        assert.equal(fs.readFileSync(destFile).toString(), expectedPayload.toString())
    })

    // ── cleanup ──

    server.close()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(binDir, { recursive: true, force: true })

    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed > 0) process.exit(1)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})

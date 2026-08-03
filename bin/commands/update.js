/**
 * meddle update - Check for updates and upgrade meddle
 *
 * Usage:
 *   meddle update                    check and upgrade to the latest version
 *   meddle update --beta             check and upgrade to the latest beta version
 *   meddle update --check            only check, print the available version
 *   meddle update --version <x.y.z>  install a specific version
 *   meddle update --auto on|off      enable/disable auto-update (default off)
 *   meddle update status             show install method / versions / auto-update
 */

const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveMeddleHome } = require('../lib/meddle-home')
const output = require('../lib/output')
const {
    compareVersions,
    getLatestVersionNpm,
    getLatestVersionGithub,
    getInstallMethod,
    checkForUpdate,
    downloadBinaryAsset,
    getAutoUpdate,
    setAutoUpdate,
    inferChannel,
} = require('../lib/update-check')

const PACKAGE_NAME = '@jonathanleelx/meddle'

const args = process.argv.slice(2)
const jsonFlag = args.includes('--json')
output.setJsonMode(jsonFlag)

const current = require(path.join(__dirname, '../../package.json')).version
const home = resolveMeddleHome()
const installMethod = getInstallMethod({ moduleDir: __dirname })

function isNpmInstall() {
    return installMethod === 'npm'
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
}

const PROGRESS_WIDTH = 40

function drawProgressBar({ received, total, attempt, maxAttempts }) {
    const label = attempt > 1 ? ` (第 ${attempt}/${maxAttempts} 次尝试)` : ''
    if (total > 0) {
        const ratio = Math.min(1, received / total)
        const filled = Math.round(PROGRESS_WIDTH * ratio)
        const bar = '#'.repeat(filled) + '-'.repeat(PROGRESS_WIDTH - filled)
        const line = `    [${bar}] ${(ratio * 100).toFixed(1)}% ${formatBytes(received)}/${formatBytes(total)}${label}`
        process.stdout.write(`\r${line}`)
    } else {
        process.stdout.write(`\r    下载中 ${formatBytes(received)}${label}...`)
    }
}

function showHelp() {
    output.plain(`
meddle update - 检查并升级 meddle

用法:
  meddle update                   检查并升级（beta 版本默认走 beta 频道）
  meddle update --beta            切换到 beta 频道并升级到最新 beta 版本
  meddle update --stable          切换到稳定频道并升级到最新稳定版本（可降级）
  meddle update --check           仅检查，提示可用版本 (有新版本时退出码为 2)
  meddle update --check --beta    仅检查 beta 版本
  meddle update --version <x.y.z> 安装指定版本
  meddle update --auto on|off     启用/禁用自动更新 (默认关闭)
  meddle update status            查看安装方式、当前版本和自动更新开关
  meddle update --help, -h        显示帮助
`)
}

async function resolveLatest({ force = false, notify = true, channel = 'stable', explicitChannel = false } = {}) {
    const info = await checkForUpdate({
        home,
        installMethod,
        current,
        force,
        channel,
        explicitChannel,
    })
    if (notify) {
        if (info.outdated) {
            output.info(`发现新版本 ${info.latest} (当前 ${info.current})`)
        } else if (info.latest === info.current) {
            output.success(`已是最新版本 (${info.current})`)
        } else {
            const channelLabel = info.channel === 'beta' ? 'beta' : '稳定'
            output.info(`当前 ${info.current} 已超过${channelLabel}频道最新版本 ${info.latest}`)
        }
    }
    return info
}

async function installVersion(version) {
    if (!isNpmInstall()) {
        const binDir = process.env.MEDDLE_BIN_DIR || path.join(home, 'bin')
        const destFile = path.join(binDir, os.platform() === 'win32' ? 'meddle.exe' : 'meddle')
        output.info(`下载 meddle ${version} (${os.platform()}/${os.arch()})...`)
        let progressShown = false
        const showProgress = output.isJsonMode() ? () => {} : drawProgressBar
        try {
            const result = await downloadBinaryAsset({
                version,
                destFile,
                platform: os.platform(),
                arch: os.arch(),
                onAttempt: (attempt, maxAttempts) => {
                    if (attempt > 1) {
                        process.stdout.write('\n')
                        progressShown = false
                        output.info(`连接中断，正在重试 (${attempt}/${maxAttempts})...`)
                    }
                },
                onProgress: (p) => {
                    showProgress(p)
                    progressShown = true
                },
            })
            if (progressShown) process.stdout.write('\n')
            output.success(`已安装 meddle ${version} 到 ${result.installed}`)
            if (result.backup) output.info(`旧版本已备份到 ${result.backup}`)
            output.info('重启 meddle 后新版本生效')
        } catch (err) {
            if (progressShown) process.stdout.write('\n')
            output.error(`升级失败: ${err && err.message ? err.message : err}`)
            process.exit(1)
        }
        return
    }

    output.info(`正在通过 npm 升级 ${PACKAGE_NAME}@${version}...`)
    const child = spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@${version}`], {
        stdio: 'inherit',
        // On Windows `npm` resolves to npm.cmd which Node cannot spawn directly
        // unless run through a shell (Node >=18.20.2/20.12.2/22.3.0: EINVAL; older: ENOENT).
        shell: os.platform() === 'win32',
    })
    if (child.error) {
        output.error(`npm 升级失败: ${child.error.message}`)
        process.exit(1)
    }
    if (child.status !== 0) {
        output.error(`npm 升级失败 (exit ${child.status})`)
        process.exit(child.status || 1)
    }
    output.success(`已升级到 ${PACKAGE_NAME}@${version}`)
}

async function run() {
    const flag = args.find((a) => a === '--check' || a === 'status' || a === '--help' || a === '-h')
    const versionFlagIndex = args.indexOf('--version')
    const autoFlagIndex = args.indexOf('--auto')
    const explicitChannel = args.includes('--beta') || args.includes('--stable')
    const channel = args.includes('--beta') ? 'beta' : args.includes('--stable') ? 'stable' : inferChannel(current)

    if (flag === '--help' || flag === '-h') {
        showHelp()
        return
    }

    if (flag === 'status') {
        const info = await resolveLatest({ notify: false, channel, explicitChannel })
        output.header('Meddle Update Status')
        output.kv('Install method', installMethod)
        output.kv('Channel', channel)
        output.kv('Current', info.current)
        output.kv('Latest', info.latest)
        output.kv('Auto-update', getAutoUpdate(home) ? 'on' : 'off')
        output.info(info.outdated ? '有新版本可用，运行 meddle update 升级' : '已是最新版本')
        return
    }

    if (autoFlagIndex >= 0) {
        const value = args[autoFlagIndex + 1]
        if (value !== 'on' && value !== 'off') {
            output.error('--auto 需要 on 或 off')
            process.exit(1)
        }
        setAutoUpdate(home, value === 'on')
        if (value === 'on' && isNpmInstall()) {
            output.success('自动更新已启用（npm 安装下仅启动时提示，仍需要运行 meddle update 升级）')
        } else {
            output.success(
                `自动更新已${value === 'on' ? '启用' : '关闭'}${value === 'on' ? '（重启 meddle 后生效）' : ''}`,
            )
        }
        return
    }

    if (versionFlagIndex >= 0) {
        const version = args[versionFlagIndex + 1]
        if (!version) {
            output.error('--version 需要版本号')
            process.exit(1)
        }
        const currentCompare = (() => {
            try { return compareVersions(version, current) } catch (_) { return null }
        })()
        if (currentCompare === null) {
            output.error(`无效版本号: ${version}`)
            process.exit(1)
        }
        if (currentCompare <= 0) {
            output.info(`当前已是 ${current}，无需降级`)
            return
        }
        await installVersion(version)
        return
    }

    if (flag === '--check') {
        const info = await resolveLatest({ channel, explicitChannel })
        if (info.outdated) process.exit(2)
        return
    }

    // default: check + upgrade
    const info = await resolveLatest({ channel, explicitChannel })
    if (!info.outdated) return
    await installVersion(info.latest)
}

run().catch((err) => {
    output.error(`检查更新失败: ${err && err.message ? err.message : err}`)
    process.exit(1)
})

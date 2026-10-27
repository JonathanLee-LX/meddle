import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import chalk from 'chalk'

// Linux `execSync('google-chrome …')` waits until Chrome exits. Chrome does not
// exit, so the caller — including the Vitest worker in tests/browser.spec.ts —
// blocks forever and the test timeout never fires (#130). Spawn instead. A
// process that is still alive after a short grace period is open. Exit 0 is
// also success: Chrome hands the URL to an existing window with the same
// profile and quits. A non-zero exit is a failed start. Kill anything that
// fails to start or that tests ask us to close.
const BROWSER_GRACE_MS = 500
const LAUNCHER_TIMEOUT_MS = 2000

const launched: ChildProcess[] = []
const profiles: string[] = []

type Platform = ReturnType<typeof os.platform>

function browserCandidates(platform: Platform): string[] {
    if (platform === 'darwin') return ['Google Chrome', 'Microsoft Edge', 'Chromium']
    if (platform === 'win32') return ['chrome', 'msedge', 'chromium']
    return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
}

function commandOnPath(name: string): string | null {
    const directories = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    const suffixes = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
        : ['']
    for (const directory of directories) {
        for (const suffix of suffixes) {
            const candidate = path.join(directory, name + suffix)
            try {
                fs.accessSync(candidate, fs.constants.X_OK)
                return candidate
            } catch {
                // try the next directory
            }
        }
    }
    return null
}

function darwinAppExists(app: string): boolean {
    const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
    return roots.some((root) => fs.existsSync(path.join(root, `${app}.app`)))
}

/** Name of a browser this machine can launch (`google-chrome`, `Google Chrome`, …), or null. */
export function findInstalledBrowser(platform: Platform = os.platform()): string | null {
    for (const app of browserCandidates(platform)) {
        if (platform === 'darwin') {
            if (darwinAppExists(app)) return app
            continue
        }
        if (commandOnPath(app)) return app
    }
    return null
}

function killPid(pid: number): void {
    try {
        // detached: true puts the child in its own process group, so this also
        // stops Chrome helpers spawned from it.
        process.kill(-pid, 'SIGKILL')
    } catch {
        try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ }
    }
}

function forget(child: ChildProcess): void {
    const index = launched.indexOf(child)
    if (index >= 0) launched.splice(index, 1)
    if (child.pid) killPid(child.pid)
}

function killProcessesUsingProfile(dir: string): void {
    if (process.platform === 'win32') return
    let output = ''
    try {
        output = execFileSync('ps', ['-Aww', '-o', 'pid=', '-o', 'args='], {
            encoding: 'utf8',
            timeout: 2000,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
    } catch {
        return
    }
    for (const line of output.split('\n')) {
        if (!line.includes(dir)) continue
        const match = /^\s*(\d+)\s/.exec(line)
        if (!match) continue
        const pid = Number(match[1])
        if (!pid || pid === process.pid) continue
        try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ }
    }
}

/** Stop browsers opened by this process. Tests call this from afterAll. */
export function closeLaunchedBrowsers(): void {
    for (const child of launched.splice(0)) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
        killPid(child.pid)
    }
    for (const dir of profiles.splice(0)) killProcessesUsingProfile(dir)
}

function spawnTracked(command: string, args: string[], shell = false): ChildProcess | null {
    try {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            shell,
        })
        // 'error' is async (ENOENT). A listener is required so Node does not
        // throw it as an unhandled error after we have already moved on.
        child.on('error', () => { /* launch promise settles this */ })
        launched.push(child)
        return child
    } catch {
        return null
    }
}

/**
 * Browser binaries stay in the foreground. Still running after the grace
 * period means opened. Exit 0 also means opened: a second Chrome with the
 * same profile hands the URL to the existing window and quits.
 */
function launchDetached(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawnTracked(command, args)
        if (!child) {
            resolve(false)
            return
        }
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (ok: boolean) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            if (ok) {
                // Already exited (handoff). Drop it so a later cleanup cannot
                // signal a recycled pid. A process that is still running stays
                // tracked so tests can close it.
                if (child.exitCode !== null || child.signalCode !== null) {
                    const index = launched.indexOf(child)
                    if (index >= 0) launched.splice(index, 1)
                }
                child.unref()
            } else {
                forget(child)
            }
            resolve(ok)
        }
        timer = setTimeout(() => {
            finish(child.exitCode === null && child.signalCode === null)
        }, BROWSER_GRACE_MS)
        child.once('error', () => finish(false))
        child.once('exit', (code) => finish(code === 0))
    })
}

/** `open`, `start`, and `xdg-open` are supposed to exit. Kill them if they do not. */
function launchExiting(command: string, args: string[], shell = false): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawnTracked(command, args, shell)
        if (!child) {
            resolve(false)
            return
        }
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (ok: boolean) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            if (ok) {
                const index = launched.indexOf(child)
                if (index >= 0) launched.splice(index, 1)
                child.unref()
            } else {
                forget(child)
            }
            resolve(ok)
        }
        timer = setTimeout(() => finish(false), LAUNCHER_TIMEOUT_MS)
        child.once('error', () => finish(false))
        child.once('exit', (code) => finish(code === 0))
    })
}

async function launchCandidate(platform: Platform, app: string, argList: string[], url: string): Promise<boolean> {
    if (platform === 'darwin') {
        return launchExiting('open', ['-a', app, '--args', ...argList, url])
    }
    if (platform === 'win32') {
        return launchExiting('cmd.exe', ['/c', 'start', '', app, ...argList, url])
    }
    const command = commandOnPath(app)
    if (!command) return false
    return launchDetached(command, [...argList, url])
}

function launchFallback(platform: Platform, url: string): Promise<boolean> {
    if (platform === 'darwin') return launchExiting('open', [url])
    if (platform === 'win32') return launchExiting('cmd.exe', ['/c', 'start', '', url])
    return launchExiting('xdg-open', [url])
}

export async function openBrowserWithProxy(url: string, proxyServer: string, meddleDir: string, remoteDebuggingPort?: number): Promise<boolean> {
    const platform = os.platform()
    const userDataDir = path.join(meddleDir, 'chrome-proxy')
    fs.mkdirSync(userDataDir, { recursive: true })
    profiles.push(userDataDir)

    const argList = [
        `--user-data-dir=${userDataDir}`,
        `--proxy-server=${proxyServer}`,
        '--window-size=1920,1080',
    ]
    if (remoteDebuggingPort) argList.push(`--remote-debugging-port=${remoteDebuggingPort}`)

    for (const app of browserCandidates(platform)) {
        if (await launchCandidate(platform, app, argList, url)) return true
    }

    if (await launchFallback(platform, url)) {
        console.log(chalk.yellow('未找到 Chrome/Edge，已用默认浏览器打开，请手动设置代理:', proxyServer))
        return true
    }
    console.error(chalk.red('浏览器并未启动:'), 'no supported browser found')
    return false
}

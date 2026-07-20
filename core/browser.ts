import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import chalk from 'chalk'

export function openBrowserWithProxy(url: string, proxyServer: string, meddleDir: string, remoteDebuggingPort?: number): boolean {
    const platform = os.platform()
    const userDataDir = path.join(meddleDir, 'chrome-proxy')
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })

    const browsers: string[] = platform === 'darwin'
        ? ['Google Chrome', 'Microsoft Edge', 'Chromium']
        : platform === 'win32'
            ? ['chrome', 'msedge', 'chromium']
            : ['google-chrome', 'chromium', 'chromium-browser']

    let proxyArgs = `--user-data-dir="${userDataDir}" --proxy-server=${proxyServer} --window-size=1920,1080`
    if (remoteDebuggingPort) proxyArgs += ` --remote-debugging-port=${remoteDebuggingPort}`

    for (const app of browsers) {
        try {
            if (platform === 'darwin') {
                execSync(`open -a "${app}" --args ${proxyArgs} "${url}"`, { stdio: 'ignore' })
                return true
            } else if (platform === 'win32') {
                execSync(`start "" "${app}" ${proxyArgs} "${url}"`, { stdio: 'ignore' })
                return true
            } else {
                execSync(`${app} ${proxyArgs} "${url}"`, { stdio: 'ignore' })
                return true
            }
        } catch (_) { continue }
    }

    try {
        if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' })
        else if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' })
        else execSync(`xdg-open "${url}"`, { stdio: 'ignore' })
        console.log(chalk.yellow('未找到 Chrome/Edge，已用默认浏览器打开，请手动设置代理:', proxyServer))
        return true
    } catch (err: any) {
        console.error(chalk.red('浏览器并未启动:'), err.message)
        return false
    }
}

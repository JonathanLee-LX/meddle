const path = require('path')
const fs = require('fs')
const chalk = require('chalk')
const { ensureRootCA } = require('./dist/cert')
const { getFreePort } = require('./dist/helpers')
const { openBrowserWithProxy } = require('./dist/core/browser')
const _debug = require('debug')

const proxyDebug = _debug('proxy')

const EP_SSL_VERIFY = process.env.EP_SSL_VERIFY === 'true' || process.env.EP_SSL_VERIFY === '1'
const SSL_REJECT_UNAUTHORIZED = EP_SSL_VERIFY || false

async function startProxyServer(proxyServer, ctx, pluginBoot) {
    await ensureRootCA()
    await pluginBoot.bootstrapBuiltinPlugins()
    const port = await getFreePort()
    proxyServer.listen(port, () => {
        const proxyUrl = `http://127.0.0.1:${port}`
        proxyDebug('proxy-server start on ' + chalk.green(proxyUrl))
        proxyDebug('plugin pipeline mode: ' + chalk.cyan(ctx.requestPipeline.mode))
        if (ctx.requestPipeline.mode === 'on') {
            proxyDebug('plugin on host allowlist: ' + (ctx.PLUGIN_ON_HOSTS.size > 0 ? Array.from(ctx.PLUGIN_ON_HOSTS).join(',') : '(all)'))
        }
        if (process.env.EP_MCP) {
            const mcpFile = path.join(ctx.epDir, 'mcp-proxy-url.json')
            const mcpData = { proxyUrl }
            if (process.env.EP_OPEN_CHROMEDEVTOOLS) mcpData.remoteDebuggingPort = 9222
            fs.writeFileSync(mcpFile, JSON.stringify(mcpData), 'utf8')
        }
        if (ctx.AUTO_OPEN) {
            const proxyAddr = `127.0.0.1:${port}`
            const remotePort = process.env.EP_OPEN_CHROMEDEVTOOLS ? 9222 : undefined
            if (openBrowserWithProxy(proxyUrl, proxyAddr, ctx.epDir, remotePort)) {
                console.log(chalk.green('已启动浏览器（代理:'), proxyAddr + chalk.green(')'))
            } else {
                console.log(chalk.yellow('浏览器并未启动，请手动打开'), chalk.cyan(proxyUrl), chalk.yellow('并设置代理'), proxyAddr)
            }
        }
    })
}

function setupErrorHandler() {
    process.on('uncaughtException', function (err) {
        console.error(err.stack)
    })
}

module.exports = { startProxyServer, setupErrorHandler, SSL_REJECT_UNAUTHORIZED }

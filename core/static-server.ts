import * as fs from 'fs'
import * as path from 'path'
import type { ProxyContext } from './types'

const STATIC_MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
}

interface HandleLocalRequestOptions {
    expressApp: any;
    serverContext: any;
    ctx: ProxyContext;
}

export function handleLocalRequest(req: any, res: any, opts: HandleLocalRequestOptions): void {
    const { expressApp, serverContext, ctx } = opts
    const webDistDir = path.resolve(__dirname, '../../web/dist')
    const hasReactBuild = fs.existsSync(path.resolve(webDistDir, 'index.html'))

    function setNoCacheHeaders(contentType: string): void {
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
    }

    if (req.url && (req.url as string).startsWith('/api')) {
        serverContext.currentMocksPath = ctx.currentMocksPath
        serverContext.routeRules = ctx.routeRules
        if (!serverContext.ruleMap) serverContext.ruleMap = ctx.ruleMap
        serverContext.excludeMap = ctx.excludeMap
        serverContext.mockRules = ctx.mockRules
        serverContext.mockIdSeq = ctx.mockIdSeq
        serverContext.settings = serverContext.loadSettingsSync()
        expressApp(req, res)
        if (serverContext.ruleMap !== ctx.ruleMap) ctx.ruleMap = serverContext.ruleMap
        if (serverContext.excludeMap !== ctx.excludeMap) ctx.excludeMap = serverContext.excludeMap
        if (serverContext.routeRules !== ctx.routeRules) ctx.routeRules = serverContext.routeRules
        if (serverContext.mockRules !== ctx.mockRules) ctx.mockRules = serverContext.mockRules
        if (serverContext.mockIdSeq !== ctx.mockIdSeq) ctx.mockIdSeq = serverContext.mockIdSeq
        return
    }

    if (hasReactBuild) {
        let filePath = req.url === '/' ? '/index.html' : req.url as string
        filePath = filePath.split('?')[0]
        const fullPath = path.resolve(webDistDir, '.' + filePath)
        if (!fullPath.startsWith(webDistDir)) { res.writeHead(403); res.end(); return }
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase()
            const contentType = STATIC_MIME[ext] || 'application/octet-stream'
            if (ext === '.html') {
                setNoCacheHeaders(contentType)
            } else {
                res.setHeader('Content-Type', contentType)
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            }
            res.writeHead(200)
            const stream = fs.createReadStream(fullPath)
            stream.on('error', (err: Error) => {
                try {
                    if (!res.headersSent) res.writeHead(500)
                    res.end()
                } catch (_) { /* ignore */ }
                console.error('Static file stream error:', err.message)
            })
            stream.pipe(res)
        } else {
            setNoCacheHeaders('text/html')
            res.writeHead(200)
            res.write(fs.readFileSync(path.resolve(webDistDir, 'index.html'), 'utf8'))
            res.end()
        }
    } else {
        if (req.url === '/' || !(req.url as string).startsWith('/api')) {
            const legacyHtml = path.resolve(__dirname, '../../index.html')
            if (fs.existsSync(legacyHtml)) {
                setNoCacheHeaders('text/html')
                res.writeHead(200)
                res.write(fs.readFileSync(legacyHtml, 'utf8'))
                res.end()
            } else { res.writeHead(404); res.end() }
        } else { res.writeHead(404); res.end() }
    }
}

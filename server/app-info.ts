import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { ServerContext } from './index'

export interface AppInfo {
    name: string
    version: string
}

const PACKAGE_NAME = '@jonathanleelx/meddle'

/**
 * Locate the Meddle root package.json by walking up from `startDir`.
 * Works both from source (server/) and compiled output (dist/server/).
 */
export function readAppInfoFromPackageJson(startDir: string = __dirname): AppInfo | null {
    let dir = path.resolve(startDir)
    for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, 'package.json')
        try {
            if (fs.existsSync(candidate)) {
                const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'))
                if (pkg && pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
                    return { name: pkg.name, version: pkg.version }
                }
            }
        } catch (_) {
            // keep walking
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    return null
}

/**
 * Resolve the running Meddle version. The root package.json is the single
 * source of truth (same file `meddle --version` reads); index.js passes it
 * through ctx.appInfo, with a filesystem lookup as fallback.
 */
export function resolveAppInfo(ctx: Pick<ServerContext, 'appInfo'>): AppInfo {
    if (ctx.appInfo && typeof ctx.appInfo.version === 'string' && ctx.appInfo.version) {
        return { name: ctx.appInfo.name || PACKAGE_NAME, version: ctx.appInfo.version }
    }
    return readAppInfoFromPackageJson() || { name: PACKAGE_NAME, version: 'unknown' }
}

export function registerAppInfoRoutes(app: Application, ctx: ServerContext): void {
    app.get('/api/version', (_req: Request, res: Response) => {
        res.json(resolveAppInfo(ctx))
    })
}

import { Application, Request, Response } from 'express'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ServerContext } from './index'
import { getRulesDir } from './rule-files'

export interface AppInfo {
    name: string
    version: string
}

/** GET /api/version payload: app info plus the data paths the server actually uses (issue #139). */
export interface AppInfoResponse extends AppInfo {
    /** Absolute route-rules directory (<MEDDLE_HOME>/route-rules). */
    routeRulesDir?: string
    /** Same directory for display: `~` for the home dir, trailing separator (e.g. `~/.meddle/route-rules/`). */
    routeRulesDirDisplay?: string
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

/**
 * Format a directory for display: paths under the home directory use the `~`
 * shorthand, and a trailing separator marks it as a directory
 * (`/Users/me/.meddle/route-rules` → `~/.meddle/route-rules/`).
 */
export function formatDisplayDir(dir: string, homeDir: string = os.homedir()): string {
    const abs = path.resolve(dir)
    const home = homeDir ? path.resolve(homeDir) : ''
    let shown = abs
    if (home && home !== path.parse(home).root) {
        if (abs === home) shown = '~'
        else if (abs.startsWith(home + path.sep)) shown = '~' + abs.slice(home.length)
    }
    return shown.endsWith(path.sep) ? shown : shown + path.sep
}

export function buildAppInfoResponse(ctx: Pick<ServerContext, 'appInfo' | 'meddleDir'>, homeDir: string = os.homedir()): AppInfoResponse {
    const info: AppInfoResponse = resolveAppInfo(ctx)
    if (ctx.meddleDir) {
        const routeRulesDir = getRulesDir(ctx)
        info.routeRulesDir = routeRulesDir
        info.routeRulesDirDisplay = formatDisplayDir(routeRulesDir, homeDir)
    }
    return info
}

export function registerAppInfoRoutes(app: Application, ctx: ServerContext): void {
    // Issue #139: also reports the route-rules directory (follows MEDDLE_HOME), so
    // the settings page shows the real path without an extra request.
    app.get('/api/version', (_req: Request, res: Response) => {
        res.json(buildAppInfoResponse(ctx))
    })
}

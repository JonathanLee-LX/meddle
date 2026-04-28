/**
 * Plugin Permission Enforcement
 * Validates and enforces plugin permissions before execution
 */

import { Plugin, PluginManifest, Logger } from './types'

// Dangerous permissions that require explicit user approval
const DANGEROUS_PERMISSIONS = [
    'network:outbound',    // External network access
    'storage:write',       // File system write
    'config:write',        // Configuration modification
    'proxy:write',         // Request/response modification
    'response:shortcircuit', // Mock/short-circuit responses
]

// Safe permissions that don't require approval
const SAFE_PERMISSIONS = [
    'proxy:read',          // Read-only proxy access
    'config:read',         // Read-only configuration
    'storage:read',        // Read-only storage
]

// All valid permissions
const ALL_VALID_PERMISSIONS = new Set([
    ...SAFE_PERMISSIONS,
    ...DANGEROUS_PERMISSIONS,
])

export interface PermissionCheckResult {
    valid: boolean
    warnings: string[]
    errors: string[]
    dangerousPermissions: string[]
    unknownPermissions: string[]
}

/**
 * Validate plugin permissions
 */
export function validatePermissions(manifest: PluginManifest): PermissionCheckResult {
    const result: PermissionCheckResult = {
        valid: true,
        warnings: [],
        errors: [],
        dangerousPermissions: [],
        unknownPermissions: [],
    }

    const permissions = manifest.permissions || []

    // Check for unknown permissions
    for (const perm of permissions) {
        if (!ALL_VALID_PERMISSIONS.has(perm)) {
            result.unknownPermissions.push(perm)
            result.warnings.push(`未知的权限声明: "${perm}"`)
        }
    }

    // Check for dangerous permissions
    for (const perm of permissions) {
        if (DANGEROUS_PERMISSIONS.includes(perm)) {
            result.dangerousPermissions.push(perm)
        }
    }

    // Warn if no permissions declared but hooks can modify data
    if (permissions.length === 0) {
        const hooks = manifest.hooks || []
        const modifyingHooks = ['onBeforeProxy', 'onBeforeResponse', 'onRequestStart']
        const hasModifyingHooks = hooks.some(h => modifyingHooks.includes(h))
        if (hasModifyingHooks) {
            result.warnings.push('插件声明了修改请求的 hooks 但未声明任何权限')
        }
    }

    return result
}

/**
 * Log permission warnings
 */
export function logPermissionWarnings(result: PermissionCheckResult, logger: Logger, pluginId: string): void {
    if (result.dangerousPermissions.length > 0) {
        logger.warn(`[${pluginId}] 插件请求了危险权限: ${result.dangerousPermissions.join(', ')}`)
        logger.warn(`[${pluginId}] 这些权限可能影响代理行为或系统安全`)
    }

    for (const warning of result.warnings) {
        logger.warn(`[${pluginId}] ${warning}`)
    }

    for (const error of result.errors) {
        logger.error(`[${pluginId}] ${error}`)
    }
}

/**
 * Check if plugin should be allowed based on permissions
 * This is a soft check - warns but doesn't block by default
 * Can be configured to block dangerous plugins via EP_BLOCK_DANGEROUS_PLUGINS
 */
export function shouldAllowPlugin(result: PermissionCheckResult): boolean {
    const BLOCK_DANGEROUS = process.env.EP_BLOCK_DANGEROUS_PLUGINS === 'true'

    if (BLOCK_DANGEROUS && result.dangerousPermissions.length > 0) {
        return false
    }

    return result.valid
}

/**
 * Wrap plugin hooks with permission checks
 * Logs when hooks use permissions not declared in manifest
 */
export function wrapPluginWithPermissionChecks(plugin: Plugin, logger?: Logger): Plugin {
    const manifest = plugin.manifest
    const declaredPerms = new Set(manifest.permissions || [])
    const log = logger || console

    const wrappedPlugin: Plugin = {
        manifest,
        setup: plugin.setup,
    }

    // Wrap each hook method
    const hookMethods = [
        'onRequestStart',
        'onBeforeProxy',
        'onAfterRequest',
        'onBeforeResponse',
        'onAfterResponse',
        'onError',
    ]

    for (const hook of hookMethods) {
        const originalHook = plugin[hook]
        if (typeof originalHook === 'function') {
            wrappedPlugin[hook] = async function(context: any) {
                // Log hook execution
                log.info(`[${manifest.id}] 执行 hook: ${hook}`)

                try {
                    await originalHook.call(plugin, context)

                    // Check for modifications that would require permissions
                    if (hook === 'onBeforeProxy' || hook === 'onRequestStart') {
                        if (context.target && context.target !== context._originalTarget) {
                            if (!declaredPerms.has('proxy:write')) {
                                log.warn(`[${manifest.id}] Hook ${hook} 修改了 target 但未声明 proxy:write 权限`)
                            }
                        }
                        if (context.shortCircuited) {
                            if (!declaredPerms.has('response:shortcircuit')) {
                                log.warn(`[${manifest.id}] Hook ${hook} 触发了短路响应但未声明 response:shortcircuit 权限`)
                            }
                        }
                    }
                } catch (error: any) {
                    log.error(`[${manifest.id}] Hook ${hook} 执行失败:`, error.message)
                    throw error
                }
            }
        }
    }

    // Copy other methods
    if (plugin.start) wrappedPlugin.start = plugin.start
    if (plugin.stop) wrappedPlugin.stop = plugin.stop
    if (plugin.dispose) wrappedPlugin.dispose = plugin.dispose

    return wrappedPlugin
}

/**
 * Security warning for plugin loading
 */
export function getSecurityWarning(manifest: PluginManifest): string {
    const lines: string[] = []
    lines.push(`⚠️  安全警告: 加载插件 ${manifest.id}`)
    lines.push(`   插件将执行以下 hooks: ${(manifest.hooks || []).join(', ')}`)
    lines.push(`   插件请求权限: ${(manifest.permissions || []).join(', ') || '无'}`)

    const dangerous = (manifest.permissions || []).filter(p => DANGEROUS_PERMISSIONS.includes(p))
    if (dangerous.length > 0) {
        lines.push(`   ⚠️  危险权限: ${dangerous.join(', ')}`)
        lines.push(`   这些权限可能修改代理行为或访问外部网络`)
    }

    lines.push(`   建议: 仅加载可信来源的插件`)
    return lines.join('\n')
}
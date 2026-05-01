import {
    Plugin,
    PluginManifest,
    PluginState,
    PluginContext,
    PluginManagerOptions,
    HookContext,
    ResponseContext,
    RequestSentContext,
    ErrorContext,
    HookDispatcherOptions,
    HookDispatchOptions,
    HookDispatchResult,
    PluginStats,
    Logger
} from './types';

const DEFAULT_HOOK_TIMEOUT_MS = 10;

function normalizeHeaders(headers: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers || typeof headers !== 'object') return out;
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        out[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
}

function cloneResponse(response: Partial<{ statusCode: number; headers: Record<string, string | string[]>; body: string | Buffer }> | null | undefined) {
    if (!response || typeof response !== 'object') return null;
    return {
        statusCode: response.statusCode || 200,
        headers: normalizeHeaders(response.headers),
        body: typeof response.body === 'string' ? response.body : String(response.body || ''),
    };
}

function snapshotHookContext(hookContext: HookContext | ResponseContext | RequestSentContext | ErrorContext) {
    return {
        target: (hookContext as HookContext).target,
        shortCircuited: (hookContext as HookContext).shortCircuited,
        requestHeaders: normalizeHeaders((hookContext as any).request?.headers),
        response: cloneResponse((hookContext as any).response),
        shortCircuitResponse: cloneResponse((hookContext as HookContext).shortCircuitResponse),
        requestSentAt: (hookContext as RequestSentContext).requestSentAt,
        phase: (hookContext as ErrorContext).phase,
        error: (hookContext as ErrorContext).error,
    };
}

export class PluginManager {
    private plugins: Map<string, Plugin>;
    private pluginStates: Map<string, PluginState>;
    private logger: Logger;
    private manifestValidator: (manifest: PluginManifest) => void;

    constructor(options: PluginManagerOptions = {}) {
        this.plugins = new Map();
        this.pluginStates = new Map();
        this.logger = options.logger || console;
        this.manifestValidator = options.manifestValidator || validateManifest;
    }

    register(plugin: Plugin): void {
        this._assertPluginShape(plugin);
        this.manifestValidator(plugin.manifest);
        if (this.plugins.has(plugin.manifest.id)) {
            throw new Error(`Duplicate plugin id: ${plugin.manifest.id}`);
        }
        this.plugins.set(plugin.manifest.id, plugin);
        this.pluginStates.set(plugin.manifest.id, 'registered');
    }

    getAll(): Plugin[] {
        return Array.from(this.plugins.values());
    }

    getState(pluginId: string): PluginState {
        return this.pluginStates.get(pluginId) || 'unknown';
    }

    setState(pluginId: string, state: PluginState): void {
        if (this.plugins.has(pluginId)) {
            this.pluginStates.set(pluginId, state);
        }
    }

    unregister(pluginId: string): void {
        this.plugins.delete(pluginId);
        this.pluginStates.delete(pluginId);
    }

    async setup(contextFactory: (manifest: PluginManifest) => PluginContext): Promise<void> {
        for (const plugin of this.getAll()) {
            const pluginContext = contextFactory(plugin.manifest);
            await this._safeLifecycleCall(plugin, 'setup', pluginContext);
            if (this.getState(plugin.manifest.id) !== 'disabled') {
                this.pluginStates.set(plugin.manifest.id, 'ready');
            }
        }
    }

    async start(): Promise<void> {
        for (const plugin of this.getAll()) {
            await this._safeLifecycleCall(plugin, 'start');
            if (this.getState(plugin.manifest.id) !== 'disabled') {
                this.pluginStates.set(plugin.manifest.id, 'running');
            }
        }
    }

    async stop(): Promise<void> {
        for (const plugin of this.getAll()) {
            await this._safeLifecycleCall(plugin, 'stop');
            if (this.getState(plugin.manifest.id) !== 'disabled') {
                this.pluginStates.set(plugin.manifest.id, 'stopped');
            }
        }
    }

    async dispose(): Promise<void> {
        for (const plugin of this.getAll()) {
            await this._safeLifecycleCall(plugin, 'dispose');
            this.pluginStates.set(plugin.manifest.id, 'disposed');
        }
    }

    private async _safeLifecycleCall(
        plugin: Plugin, 
        methodName: keyof Plugin, 
        ...args: any[]
    ): Promise<void> {
        const fn = plugin[methodName];
        if (typeof fn !== 'function') return;
        try {
            await (fn as Function).apply(plugin, args);
        } catch (error: any) {
            this.pluginStates.set(plugin.manifest.id, 'disabled');
            this.logger.error(
                `[plugin-runtime] ${plugin.manifest.id}.${String(methodName)} failed:`,
                error && error.message ? error.message : error
            );
        }
    }

    private _assertPluginShape(plugin: any): asserts plugin is Plugin {
        if (!plugin || typeof plugin !== 'object') throw new Error('Plugin must be an object');
        if (!plugin.manifest || typeof plugin.manifest !== 'object') throw new Error('Plugin manifest is required');
        if (typeof plugin.setup !== 'function') throw new Error('Plugin setup() is required');
    }
}

export class HookDispatcher {
    private pluginManager: PluginManager;
    private logger: Logger;
    private defaultTimeoutMs: number;
    private pluginHookStats: Map<string, PluginStats>;

    constructor(pluginManager: PluginManager, options: HookDispatcherOptions = {}) {
        this.pluginManager = pluginManager;
        this.logger = options.logger || console;
        this.defaultTimeoutMs = options.defaultTimeoutMs || DEFAULT_HOOK_TIMEOUT_MS;
        this.pluginHookStats = new Map();
    }

    async dispatch(
        hookName: string,
        hookContext: HookContext | ResponseContext | ErrorContext,
        options: HookDispatchOptions = {}
    ): Promise<HookDispatchResult[]> {
        const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
        const plugins = this._getOrderedPluginsForHook(hookName);
        const results: HookDispatchResult[] = [];
        
        for (const plugin of plugins) {
            const pluginId = plugin.manifest.id;
            if (this.pluginManager.getState(pluginId) === 'disabled') {
                results.push({ pluginId, status: 'skipped-disabled', duration: 0 });
                continue;
            }
            const hookFn = plugin[hookName];
            if (typeof hookFn !== 'function') continue;
            
            const start = Date.now();
            const contextBefore = snapshotHookContext(hookContext);
            try {
                await runWithTimeout(
                    Promise.resolve(hookFn.call(plugin, hookContext)),
                    timeoutMs,
                    `${pluginId}.${hookName}`
                );
                this._recordHookStat(pluginId, hookName, 'ok', Date.now() - start);
                results.push({
                    pluginId,
                    status: 'ok',
                    duration: Date.now() - start,
                    contextBefore,
                    contextAfter: snapshotHookContext(hookContext),
                });
            } catch (error: any) {
                const isTimeout = error && error.code === 'PLUGIN_HOOK_TIMEOUT';
                const status = isTimeout ? 'timeout' : 'error';
                this._recordHookStat(pluginId, hookName, status, Date.now() - start, error);
                results.push({
                    pluginId,
                    status,
                    duration: Date.now() - start,
                    error: error && error.message ? error.message : String(error),
                    contextBefore,
                    contextAfter: snapshotHookContext(hookContext),
                });
                this.logger.error(
                    `[plugin-runtime] hook ${pluginId}.${hookName} failed:`,
                    error && error.message ? error.message : error
                );
            }
        }
        return results;
    }

    getPluginStats(): Record<string, PluginStats> {
        const out: Record<string, PluginStats> = {};
        for (const [pluginId, value] of this.pluginHookStats.entries()) {
            out[pluginId] = {
                total: value.total,
                ok: value.ok,
                error: value.error,
                timeout: value.timeout,
                lastHook: value.lastHook,
                lastDuration: value.lastDuration,
                lastError: value.lastError,
            };
        }
        return out;
    }

    private _getOrderedPluginsForHook(hookName: string): Plugin[] {
        return this.pluginManager
            .getAll()
            .filter((plugin) => Array.isArray(plugin.manifest.hooks) && plugin.manifest.hooks.includes(hookName))
            .sort((a, b) => {
                const pa = typeof a.manifest.priority === 'number' ? a.manifest.priority : 100;
                const pb = typeof b.manifest.priority === 'number' ? b.manifest.priority : 100;
                if (pa !== pb) return pa - pb;
                return a.manifest.id.localeCompare(b.manifest.id);
            });
    }

    private _recordHookStat(
        pluginId: string, 
        hookName: string, 
        status: 'ok' | 'error' | 'timeout', 
        duration: number, 
        error?: Error
    ): void {
        const current = this.pluginHookStats.get(pluginId) || {
            total: 0,
            ok: 0,
            error: 0,
            timeout: 0,
            lastHook: null,
            lastDuration: null,
            lastError: null,
        };
        current.total += 1;
        current[status] += 1;
        current.lastHook = hookName;
        current.lastDuration = duration;
        current.lastError = error ? (error.message || String(error)) : null;
        this.pluginHookStats.set(pluginId, current);
    }
}

export function validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== 'string') {
        throw new Error('manifest.id is required');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error('manifest.version is required');
    }
    if (!manifest.apiVersion || typeof manifest.apiVersion !== 'string') {
        throw new Error('manifest.apiVersion is required');
    }
    if (!Array.isArray(manifest.permissions)) {
        throw new Error('manifest.permissions must be an array');
    }
    if (!Array.isArray(manifest.hooks)) {
        throw new Error('manifest.hooks must be an array');
    }
}

export function runWithTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    label: string
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error: any = new Error(`Timeout in ${label} after ${timeoutMs}ms`);
            error.code = 'PLUGIN_HOOK_TIMEOUT';
            reject(error);
        }, timeoutMs);
        promise
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

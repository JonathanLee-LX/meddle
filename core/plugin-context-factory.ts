import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import {
    PluginManifest,
    PluginContext,
    PluginConfigAPI,
    PluginStoreAPI,
    PluginEventBusAPI,
    Logger
} from './types';

const epDir = path.resolve(os.homedir(), '.ep');
const pluginsDir = path.resolve(epDir, 'plugins-data');

// Ensure plugins-data directory exists
function ensurePluginsDir(): void {
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }
}

// Shared event bus instance (global for all plugins)
const globalEventBus = new EventEmitter();

/**
 * Create a plugin-specific logger that prefixes messages with plugin id
 */
export function createPluginLogger(manifest: PluginManifest, baseLogger: Logger = console): Logger {
    const prefix = `[${manifest.id}]`;
    return {
        debug: (...args: any[]) => baseLogger.debug(prefix, ...args),
        log: (...args: any[]) => baseLogger.log(prefix, ...args),
        info: (...args: any[]) => baseLogger.info(prefix, ...args),
        warn: (...args: any[]) => baseLogger.warn(prefix, ...args),
        error: (...args: any[]) => baseLogger.error(prefix, ...args),
    };
}

/**
 * Create a plugin configuration API
 * Config is stored in ~/.ep/plugins-data/{plugin-id}.json
 */
export function createPluginConfigAPI(manifest: PluginManifest): PluginConfigAPI {
    ensurePluginsDir();
    const configPath = path.resolve(pluginsDir, `${manifest.id}.json`);
    let config: Record<string, any> = {};

    // Load existing config
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            config = JSON.parse(content);
        }
    } catch {
        // Ignore parse errors, start with empty config
    }

    const persist = (): void => {
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        } catch (err: any) {
            console.error(`[${manifest.id}] Failed to persist config:`, err.message);
        }
    };

    return {
        get<T = unknown>(key: string, fallback?: T): T {
            const parts = key.split('.');
            let value: any = config;
            for (const part of parts) {
                if (value == null || typeof value !== 'object') return fallback as T;
                value = value[part];
            }
            return (value ?? fallback) as T;
        },
        set<T = unknown>(key: string, value: T): void {
            const parts = key.split('.');
            let obj: any = config;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (obj[part] == null || typeof obj[part] !== 'object') {
                    obj[part] = {};
                }
                obj = obj[part];
            }
            obj[parts[parts.length - 1]] = value;
            persist();
        },
    };
}

/**
 * Create a plugin private storage API
 * Store is stored in ~/.ep/plugins-data/{plugin-id}.store.json
 */
export function createPluginStoreAPI(manifest: PluginManifest): PluginStoreAPI {
    ensurePluginsDir();
    const storePath = path.resolve(pluginsDir, `${manifest.id}.store.json`);
    let store: Record<string, any> = {};

    // Load existing store
    try {
        if (fs.existsSync(storePath)) {
            const content = fs.readFileSync(storePath, 'utf8');
            store = JSON.parse(content);
        }
    } catch {
        // Ignore parse errors, start with empty store
    }

    const persist = (): void => {
        try {
            fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
        } catch (err: any) {
            console.error(`[${manifest.id}] Failed to persist store:`, err.message);
        }
    };

    return {
        get<T = unknown>(key: string): T | undefined {
            return store[key] as T;
        },
        set<T = unknown>(key: string, value: T): void {
            store[key] = value;
            persist();
        },
        delete(key: string): void {
            delete store[key];
            persist();
        },
        clear(): void {
            store = {};
            persist();
        },
    };
}

/**
 * Create a plugin event bus API
 * Uses a global EventEmitter shared across all plugins
 */
export function createPluginEventBusAPI(): PluginEventBusAPI {
    return {
        emit(topic: string, payload: unknown): void {
            globalEventBus.emit(topic, payload);
        },
        on(topic: string, handler: (payload: unknown) => void): () => void {
            globalEventBus.on(topic, handler);
            return () => globalEventBus.off(topic, handler);
        },
        off(topic: string, handler?: (payload: unknown) => void): void {
            if (handler) {
                globalEventBus.off(topic, handler);
            } else {
                globalEventBus.removeAllListeners(topic);
            }
        },
    };
}

/**
 * Create a complete PluginContext for a plugin
 */
export function createPluginContext(manifest: PluginManifest, baseLogger?: Logger): PluginContext {
    return {
        manifest,
        log: createPluginLogger(manifest, baseLogger || console),
        config: createPluginConfigAPI(manifest),
        store: createPluginStoreAPI(manifest),
        eventBus: createPluginEventBusAPI(),
    };
}

/**
 * Create a context factory function for use in bootstrapPlugins
 */
export function createPluginContextFactory(baseLogger?: Logger): (manifest: PluginManifest) => PluginContext {
    return (manifest: PluginManifest) => createPluginContext(manifest, baseLogger);
}
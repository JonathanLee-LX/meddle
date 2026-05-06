/**
 * 自定义插件加载器
 * 从 ~/.ep/plugins/ 目录加载用户自定义的插件
 */

import * as fs from 'fs';
import * as path from 'path';
import { Plugin, Logger } from './types';

export interface CustomPluginLoaderOptions {
    pluginsDir: string;
    logger?: Logger;
}

/**
 * 加载单个插件文件
 */
async function loadPluginFile(filePath: string, logger?: Logger): Promise<Plugin | null> {
    try {
        // 只加载.js文件
        if (!filePath.endsWith('.js')) {
            if (logger) {
                logger.warn(`跳过非JS文件: ${path.basename(filePath)}`);
            }
            return null;
        }
        
        let actualFilePath = filePath;
        
        // 使用Node.js的require加载JavaScript模块
        // 清除require缓存，确保加载最新版本
        delete require.cache[require.resolve(actualFilePath)];
        
        const pluginModule = require(actualFilePath);
        
        // 插件可能通过exports.plugin或module.exports导出
        const pluginObj = pluginModule.plugin || pluginModule.default || pluginModule;

        // 验证插件对象
        if (!pluginObj || typeof pluginObj !== 'object') {
            throw new Error('插件必须导出一个对象');
        }

        if (!pluginObj.manifest || typeof pluginObj.setup !== 'function') {
            throw new Error('插件必须包含 manifest 和 setup 方法');
        }

        return pluginObj as Plugin;
    } catch (error: any) {
        if (logger) {
            logger.error(`加载插件文件 ${filePath} 失败:`, error.message);
        }
        return null;
    }
}

/**
 * 从指定目录加载所有自定义插件
 */
export async function loadCustomPlugins(options: CustomPluginLoaderOptions): Promise<Plugin[]> {
    const { pluginsDir, logger } = options;
    const plugins: Plugin[] = [];

    try {
        // 检查插件目录是否存在
        if (!fs.existsSync(pluginsDir)) {
            if (logger) {
                logger.info(`插件目录不存在，将创建: ${pluginsDir}`);
            }
            fs.mkdirSync(pluginsDir, { recursive: true });
            return plugins;
        }

        // 读取目录中的所有.js文件
        const files = fs.readdirSync(pluginsDir);
        const pluginFiles = files.filter(f => f.endsWith('.js'));

        if (logger) {
            logger.info(`发现 ${pluginFiles.length} 个插件文件`);
        }

        // 加载每个插件文件
        for (const file of pluginFiles) {
            const filePath = path.join(pluginsDir, file);
            const plugin = await loadPluginFile(filePath, logger);
            
            if (plugin) {
                plugins.push(plugin);
                if (logger) {
                    logger.info(`已加载插件: ${plugin.manifest.id} (${file})`);
                }
            }
        }

        if (logger) {
            logger.info(`成功加载 ${plugins.length} 个自定义插件`);
        }

        return plugins;
    } catch (error: any) {
        if (logger) {
            logger.error('加载自定义插件失败:', error.message);
        }
        return plugins;
    }
}

/**
 * 监听插件目录变化并重新加载（可选功能）
 */
export function watchPluginsDirectory(
    pluginsDir: string,
    onReload: (plugins: Plugin[]) => void,
    logger?: Logger
): () => void {
    const chokidar = require('chokidar');
    
    const watcher = chokidar.watch(pluginsDir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
    });

    let reloadTimeout: NodeJS.Timeout | null = null;

    const scheduleReload = () => {
        if (reloadTimeout) {
            clearTimeout(reloadTimeout);
        }
        reloadTimeout = setTimeout(async () => {
            if (logger) {
                logger.info('插件目录变化，重新加载插件...');
            }
            const plugins = await loadCustomPlugins({ pluginsDir, logger });
            onReload(plugins);
        }, 1000);
    };

    watcher
        .on('add', (path: string) => {
            if (path.endsWith('.ts') || path.endsWith('.js')) {
                if (logger) {
                    logger.info(`新插件文件: ${path}`);
                }
                scheduleReload();
            }
        })
        .on('change', (path: string) => {
            if (path.endsWith('.ts') || path.endsWith('.js')) {
                if (logger) {
                    logger.info(`插件文件变化: ${path}`);
                }
                scheduleReload();
            }
        })
        .on('unlink', (path: string) => {
            if (path.endsWith('.ts') || path.endsWith('.js')) {
                if (logger) {
                    logger.info(`插件文件删除: ${path}`);
                }
                scheduleReload();
            }
        });

    // 返回一个停止监听的函数
    return () => {
        if (reloadTimeout) {
            clearTimeout(reloadTimeout);
        }
        watcher.close();
    };
}

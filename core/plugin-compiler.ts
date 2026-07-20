/**
 * 插件编译器
 * 将TypeScript插件代码编译为JavaScript
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

export interface CompileResult {
    success: boolean;
    jsCode?: string;
    error?: string;
    sourceMap?: string;
}

/**
 * 编译TypeScript插件代码为JavaScript
 */
export async function compilePluginCode(
    tsCode: string,
    _filename: string = 'plugin.ts'
): Promise<CompileResult> {
    try {
        const result = await esbuild.transform(tsCode, {
            loader: 'ts',
            target: 'node18',
            format: 'cjs',
            platform: 'node',
            sourcemap: 'inline',
            minify: false,
            keepNames: true,
        });

        return {
            success: true,
            jsCode: result.code,
            sourceMap: result.map,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || '编译失败',
        };
    }
}

/**
 * 编译插件文件
 * 读取.ts文件，编译并保存为.js文件
 */
export async function compilePluginFile(
    tsFilePath: string
): Promise<CompileResult> {
    try {
        // 读取TypeScript文件
        if (!fs.existsSync(tsFilePath)) {
            return {
                success: false,
                error: '文件不存在: ' + tsFilePath,
            };
        }

        const tsCode = fs.readFileSync(tsFilePath, 'utf8');

        // 编译
        const compileResult = await compilePluginCode(tsCode, path.basename(tsFilePath));

        if (!compileResult.success) {
            return compileResult;
        }

        // 保存编译后的JavaScript文件
        const jsFilePath = tsFilePath.replace(/\.ts$/, '.js');
        fs.writeFileSync(jsFilePath, compileResult.jsCode!, 'utf8');

        return {
            success: true,
            jsCode: compileResult.jsCode,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || '编译文件失败',
        };
    }
}

/**
 * 批量编译插件目录中的所有.ts文件
 */
export async function compilePluginsDirectory(
    pluginsDir: string
): Promise<{ total: number; success: number; failed: number; errors: string[] }> {
    const result = {
        total: 0,
        success: 0,
        failed: 0,
        errors: [] as string[],
    };

    try {
        if (!fs.existsSync(pluginsDir)) {
            return result;
        }

        const files = fs.readdirSync(pluginsDir);
        const tsFiles = files.filter(file => file.endsWith('.ts'));

        result.total = tsFiles.length;

        for (const file of tsFiles) {
            const filePath = path.join(pluginsDir, file);
            const compileResult = await compilePluginFile(filePath);

            if (compileResult.success) {
                result.success++;
            } else {
                result.failed++;
                result.errors.push(`${file}: ${compileResult.error}`);
            }
        }

        return result;
    } catch (error: any) {
        result.errors.push('目录编译失败: ' + error.message);
        return result;
    }
}

/**
 * 验证编译后的JavaScript代码
 * 检查是否包含必需的plugin导出
 */
export function validateCompiledPlugin(jsCode: string): { valid: boolean; error?: string } {
    try {
        // 检查是否包含exports.plugin或module.exports.plugin
        if (!jsCode.includes('exports.plugin') && !jsCode.includes('module.exports')) {
            return {
                valid: false,
                error: '编译后的代码没有导出plugin对象',
            };
        }

        // 检查是否包含manifest
        if (!jsCode.includes('manifest')) {
            return {
                valid: false,
                error: '编译后的代码缺少manifest定义',
            };
        }

        return { valid: true };
    } catch (error: any) {
        return {
            valid: false,
            error: error.message,
        };
    }
}

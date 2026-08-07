const EasyCert = require('node-easy-cert');
import * as os from 'os';
const inquirer = require('inquirer');
import { execSync } from 'child_process';
import { stat, mkdirSync, existsSync } from 'fs';
import * as path from 'path';

// 证书存储在 .meddle/ca 目录下（保持独立）
const rootDirPath = path.resolve(os.homedir(), '.meddle', 'ca');

const options = {
    rootDirPath: rootDirPath,
    inMemory: false,
    defaultCertAttrs: [
        { name: 'countryName', value: 'CN' },
        { name: 'organizationName', value: 'meddle' },
        { shortName: 'ST', value: 'SH' },
        { shortName: 'OU', value: 'meddle SSL Proxy' }
    ]
};

// 所有外部子进程调用的超时保护：security/openssl 卡住时不阻塞启动
const EXEC_TIMEOUT_MS = 5000;

const easyCert = new EasyCert(options);
const crtMgr = Object.assign({}, easyCert);

crtMgr.ifRootCAFileExists = easyCert.isRootCAFileExists;

interface CertPaths {
    keyPath: string;
    crtPath: string;
}

async function doGenerate(overwrite: boolean): Promise<CertPaths> {
    const rootOptions = {
        commonName: 'meddle',
        overwrite: overwrite
    };

    return new Promise((resolvePromise, reject) => {
        stat(rootDirPath, (err, stats) => {
            if (err) {
                mkdirSync(rootDirPath, { recursive: true });
            } else if (stats.isDirectory()) {
                // directory exists
            }

            easyCert.generateRootCA(rootOptions, (error: Error | null, keyPath: string, crtPath: string) => {
                if (error) reject(error);
                else resolvePromise({ keyPath, crtPath });
            });
        });
    });
}

interface CAStatus {
    exist: boolean;
    trusted?: boolean;
}

// Exported for future use
export async function getCAStatus(): Promise<CAStatus> {
    const result: CAStatus = {
        exist: false,
    };
    const ifExist = easyCert.isRootCAFileExists();
    if (!ifExist) {
        return result;
    } else {
        result.exist = true;
        result.trusted = checkCATrusted();
        return result;
    }
}

function openCertForUser(rootCAPath: string): void {
    const platform = os.platform();
    if (platform === 'darwin') {
        try {
            execSync(`open "${rootCAPath}"`, { stdio: 'inherit' });
            console.log('\n已打开证书文件，请在 Keychain Access 中：');
            console.log('  1. 双击证书 -> 展开「Trust」');
            console.log('  2. 将「When using this certificate」设为「Always Trust」');
            console.log('  3. 关闭窗口并输入密码保存\n');
        } catch (err) {
            console.log('证书路径:', rootCAPath);
        }
    } else if (platform === 'win32') {
        try {
            execSync(`start "" "${rootCAPath}"`, { stdio: 'inherit' });
            console.log('\n已打开证书，请按系统提示安装并信任。\n');
        } catch (err) {
            console.log('证书路径:', rootCAPath);
        }
    }
}

async function trustRootCA(): Promise<void> {
    const platform = os.platform();
    const rootCAPath = crtMgr.getRootCAFilePath();

    const answer = await inquirer.prompt([
        {
            type: 'list',
            name: 'trustCA',
            message: '根证书尚未信任，请选择操作：',
            choices: [
                { name: '自动添加信任（需输入密码）', value: 'auto' },
                { name: '打开证书文件，手动添加信任', value: 'manual' },
                { name: '稍后自行处理', value: 'skip' }
            ]
        }
    ]);

    if (answer.trustCA === 'manual') {
        openCertForUser(rootCAPath);
        return;
    }

    if (answer.trustCA === 'skip') {
        console.log('证书路径:', rootCAPath, '- 请稍后手动添加信任以支持 HTTPS 代理。');
        return;
    }

    if (answer.trustCA === 'auto') {
        if (platform === 'darwin') {
            try {
                execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${rootCAPath}"`, {
                    stdio: 'inherit'
                });
                console.log('根证书已成功添加到系统信任。');
            } catch (err) {
                console.error('自动添加失败，正在打开证书文件供手动添加...');
                openCertForUser(rootCAPath);
            }
        } else if (platform === 'win32') {
            openCertForUser(rootCAPath);
        } else if (platform === 'linux') {
            const certName = 'meddle-root-ca.crt';
            const isDebian = existsSync('/usr/local/share/ca-certificates');
            const isRhel = existsSync('/etc/pki/ca-trust/source/anchors');
            try {
                if (isDebian) {
                    const dest = `/usr/local/share/ca-certificates/${certName}`;
                    execSync(`sudo cp "${rootCAPath}" "${dest}" && sudo update-ca-certificates`, {
                        stdio: 'inherit'
                    });
                    console.log('根证书已成功添加到系统信任。');
                } else if (isRhel) {
                    const dest = `/etc/pki/ca-trust/source/anchors/${certName}`;
                    execSync(`sudo cp "${rootCAPath}" "${dest}" && sudo update-ca-trust`, {
                        stdio: 'inherit'
                    });
                    console.log('根证书已成功添加到系统信任。');
                } else {
                    console.log('未识别的 Linux 发行版，请手动安装证书。');
                    openCertForUser(rootCAPath);
                }
            } catch (err) {
                console.error('自动添加失败，正在打开证书文件供手动添加...');
                openCertForUser(rootCAPath);
            }
        }
    }
}

export function checkCATrusted(): boolean {
    const rootCAPath = crtMgr.getRootCAFilePath();
    if (!rootCAPath) return false;
    const platform = os.platform();
    try {
        if (platform === 'darwin') {
            execSync(`security find-certificate -c "meddle" /Library/Keychains/System.keychain`, {
                stdio: 'pipe',
                timeout: EXEC_TIMEOUT_MS,
            });
            return true;
        } else if (platform === 'linux') {
            const caBundles = [
                '/etc/ssl/certs/ca-certificates.crt',
                '/etc/pki/tls/certs/ca-bundle.crt',
            ];
            for (const bundle of caBundles) {
                if (existsSync(bundle)) {
                    execSync(`openssl verify -CAfile "${bundle}" "${rootCAPath}"`, {
                        stdio: 'pipe',
                        timeout: EXEC_TIMEOUT_MS,
                    });
                    return true;
                }
            }
            return false;
        } else {
            return false;
        }
    } catch {
        return false;
    }
}

export async function ensureRootCA(opts: { trustCheckAsync?: boolean } = {}): Promise<void> {
    if (!crtMgr.ifRootCAFileExists()) {
        const { keyPath, crtPath } = await doGenerate(false);
        console.log('根证书已生成:', keyPath, crtPath);
    }

    const runTrustCheck = (): void => {
        try {
            const isTrusted = checkCATrusted();
            if (!isTrusted && !process.env.MEDDLE_HEADLESS && !process.env.MEDDLE_MCP) {
                trustRootCA();
            }
        } catch (err) {
            console.error('证书信任检查失败:', getErrorMessage(err));
        }
    };

    if (opts.trustCheckAsync) {
        // 不缓存结果：每次启动都真实检查，避免掩盖系统证书状态的变化。
        // 异步执行，不阻塞代理启动——Keychain 慢/卡住不影响上线。
        setImmediate(runTrustCheck);
        return;
    }

    runTrustCheck();
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function getRootCAPath(): string {
    return crtMgr.getRootCAFilePath();
}

export { crtMgr };

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});

describe('checkCATrusted', () => {
    let checkCATrusted: typeof import('../cert').checkCATrusted;
    let crtMgr: typeof import('../cert').crtMgr;
    const mockExecSync = vi.mocked(execSync);
    const mockExistsSync = vi.mocked(existsSync);

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const mod = await import('../cert');
        checkCATrusted = mod.checkCATrusted;
        crtMgr = mod.crtMgr;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns false when no root CA file exists', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('');
        expect(checkCATrusted()).toBe(false);
    });

    it('macOS: returns true when security find-certificate succeeds', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        mockExecSync.mockImplementation(() => Buffer.from(''));
        expect(checkCATrusted()).toBe(true);
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('security find-certificate'),
            expect.objectContaining({ stdio: 'pipe' })
        );
    });

    it('macOS: returns false when security find-certificate fails', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        mockExecSync.mockImplementation(() => { throw new Error('not found'); });
        expect(checkCATrusted()).toBe(false);
    });

    it('Linux: returns true when openssl verify succeeds with CA bundle', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        mockExistsSync.mockImplementation((p) => p === '/etc/ssl/certs/ca-certificates.crt');
        mockExecSync.mockImplementation(() => Buffer.from('OK'));
        expect(checkCATrusted()).toBe(true);
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('openssl verify'),
            expect.objectContaining({ stdio: 'pipe' })
        );
    });

    it('Linux: returns false when no CA bundle found', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        mockExistsSync.mockReturnValue(false);
        expect(checkCATrusted()).toBe(false);
        expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('Linux: returns false when openssl verify fails', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        mockExistsSync.mockImplementation((p) => p === '/etc/pki/tls/certs/ca-bundle.crt');
        mockExecSync.mockImplementation(() => { throw new Error('verify error'); });
        expect(checkCATrusted()).toBe(false);
    });

    it('passes a timeout to the underlying execSync call (never hangs startup)', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        mockExecSync.mockImplementation(() => Buffer.from(''));
        checkCATrusted();
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('security find-certificate'),
            expect.objectContaining({ stdio: 'pipe', timeout: expect.any(Number) })
        );
    });

    it('returns false when execSync times out instead of blocking forever', () => {
        vi.spyOn(crtMgr, 'getRootCAFilePath').mockReturnValue('/tmp/rootCA.crt');
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        mockExecSync.mockImplementation(() => {
            const err = new Error('ETIMEDOUT') as Error & { code: string };
            err.code = 'ETIMEDOUT';
            throw err;
        });
        expect(checkCATrusted()).toBe(false);
    });
});

describe('ensureRootCA async trust check', () => {
    let ensureRootCA: typeof import('../cert').ensureRootCA;
    let crtMgr: typeof import('../cert').crtMgr;
    const mockExecSync = vi.mocked(execSync);

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const mod = await import('../cert');
        ensureRootCA = mod.ensureRootCA;
        crtMgr = mod.crtMgr;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns immediately when the root CA already exists (trust check is async)', async () => {
        vi.spyOn(crtMgr, 'ifRootCAFileExists').mockReturnValue(true);
        const promise = ensureRootCA({ trustCheckAsync: true });
        expect(mockExecSync).not.toHaveBeenCalled();
        await expect(Promise.race([promise, new Promise(r => setTimeout(r, 50))])).resolves.toBeUndefined();
    });
});

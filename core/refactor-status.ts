import { RefactorStatus, RefactorStatusInput } from './types';

export function buildRefactorStatus(input: RefactorStatusInput = {}): RefactorStatus {
    const now = Date.now();
    return {
        generatedAt: now,
        runtime: input.runtime || null,
        mode: input.mode || 'off',
        allowlist: Array.isArray(input.allowlist) ? input.allowlist : [],
        readiness: input.readiness || null,
        advice: input.advice || null,
        shadow: input.shadowStats || null,
        onModeGate: input.onModeGate || null,
        plugins: input.plugins || [],
        loggerSummary: input.loggerSummary || null,
    };
}

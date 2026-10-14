import type { Reporter, TestModule, TestCase } from 'vitest/node'

/**
 * Issue #130: a full run once hung inside a worker with no output. In CI this
 * prints when each test file / test starts and ends (with elapsed time), so a
 * hang shows exactly which file and test never finished.
 */
export default class ProgressReporter implements Reporter {
    private t0 = Date.now()
    private ts(): string { return `+${((Date.now() - this.t0) / 1000).toFixed(1)}s` }
    onTestModuleStart(m: TestModule): void { console.log(`[progress ${this.ts()}] START ${m.moduleId}`) }
    onTestModuleEnd(m: TestModule): void { console.log(`[progress ${this.ts()}] END   ${m.moduleId} (${m.state()})`) }
    onTestCaseReady(t: TestCase): void { console.log(`[progress ${this.ts()}]   test ${t.fullName}`) }
    onTestCaseResult(t: TestCase): void {
        const d = t.diagnostic()
        const dur = d ? `${d.duration.toFixed(0)}ms` : 'n/a'
        console.log(`[progress ${this.ts()}]   done ${t.fullName} (${t.result().state}, ${dur})`)
    }
}

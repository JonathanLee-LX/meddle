import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
    testTimeout: 10000,
    // Bound hooks/teardown so a leaked handle fails the run instead of hanging
    // (#130). tests/browser.spec.ts stays in the suite: the launcher detaches
    // Chrome instead of blocking, and skips the real launch when none is installed.
    hookTimeout: 20000,
    teardownTimeout: 10000,
    reporters: process.env.CI ? ['default', 'hanging-process', './tests/support/progress-reporter.ts'] : ['default'],
  },
})

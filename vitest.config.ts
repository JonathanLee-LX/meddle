import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
    testTimeout: 10000,
    // Issue #130: a full run once hung in a worker. Bound hooks/teardown so a
    // leaked handle fails the run instead of hanging, and in CI list the
    // handles that keep the process alive (hanging-process reporter).
    hookTimeout: 20000,
    teardownTimeout: 10000,
    reporters: process.env.CI ? ['default', 'hanging-process', './tests/support/progress-reporter.ts'] : ['default'],
    exclude: process.env.CI ? ['tests/browser.spec.ts'] : [],
  },
})

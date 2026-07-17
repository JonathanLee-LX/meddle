import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
    testTimeout: 10000,
    exclude: process.env.CI ? ['tests/browser.spec.ts'] : [],
  },
})

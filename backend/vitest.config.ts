import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Integration tests share a single Postgres DB; running files in parallel
    // causes beforeEach hooks in one file to delete rows mid-test in another.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})

import { defineConfig } from 'vitest/config'

// Fast unit tests for the pure, security/correctness-critical logic (no DB / Next
// runtime needed) — co-located as src/**/*.test.ts. Runs in CI after typecheck.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

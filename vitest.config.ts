import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Fast unit tests for the pure, security/correctness-critical logic (no DB / Next
// runtime needed) — co-located as src/**/*.test.ts. Runs in CI after typecheck.
export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside an RSC; alias it to a noop so we can unit-test the
      // pure functions inside server-only modules (e.g. the OAuth JWT crypto).
      'server-only': fileURLToPath(new URL('./src/test/empty-module.ts', import.meta.url)),
      // Match tsconfig's `@/*` → `src/*`. Without it, any tested module that imports a
      // sibling via the alias fails to resolve at RUNTIME even though tsc is happy.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // A deterministic signing secret so the OAuth token tests are reproducible. NOT a real
    // secret — production derives the key from the live SUPABASE_SECRET_KEY at runtime.
    env: { SUPABASE_SECRET_KEY: 'test-only-signing-secret-do-not-use-in-prod' },
  },
})

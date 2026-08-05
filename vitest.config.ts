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
    /**
     * ⚠️ THE SUITE'S ANSWER MUST NOT DEPEND ON THE MACHINE RUNNING IT.
     *
     * Measured 2026-08-05: `npm test` was RED locally and GREEN in CI on the legal-boundary test
     * `src/app/vietnam-evisa/service-jsonld.test.ts` — same commit, opposite results — because this
     * developer's shell exports the repo `.env` (NEXT_PUBLIC_APP_URL=https://eno.vn) while CI's
     * fresh checkout exports nothing. A local gate that disagrees with CI is not a gate, and this
     * project's standing rule is that changes are verified locally before they ship.
     *
     * ⚠️ VITEST IS NOT THE LEAK, AND THE OBVIOUS FIX IS A NO-OP — RECORDED SO NOBODY RE-ADDS IT.
     * The tempting change is `envDir: <a directory holding no .env>`, on the theory that vitest
     * inherits Vite's env-file loading. It does not: this suite was run under `env -i` both with
     * and without that override and produced an identical empty environment both times. The
     * pollution arrives from the SHELL, which no vitest setting can reach. The two fixes that do
     * work are (a) pinning below what the suite must never inherit, and (b) tests that stub their
     * own environment — which is what service-jsonld.test.ts now does.
     */
    env: {
      // A deterministic signing secret so the OAuth token tests are reproducible. NOT a real
      // secret — production derives the key from the live SUPABASE_SECRET_KEY at runtime.
      SUPABASE_SECRET_KEY: 'test-only-signing-secret-do-not-use-in-prod',
      /**
       * ⚠️ PINNED BECAUSE IT SELECTS A LEGAL BOUNDARY, NOT BECAUSE IT CHANGES ANYTHING TODAY.
       * `src/lib/edition.ts` folds an ABSENT value to 'services', so this matches what a clean run
       * already gets. What it buys is immunity: a shell exporting
       * NEXT_PUBLIC_ENO_EDITION=marketplace would flip SITE_NAME to 'eno.vn' and silently change
       * what every visa/itinerary test asserts. "Whatever the ambient default happens to be" is the
       * wrong way to choose the edition in the one place that proves the boundary holds.
       *
       * ⚠️ NEXT_PUBLIC_APP_URL IS DELIBERATELY NOT PINNED. service-jsonld.test.ts asserts the "no
       * host configured" case on purpose — `url` is optional there and absent beats wrong — so a
       * value here would delete that coverage. That file stubs both configurations itself instead.
       */
      NEXT_PUBLIC_ENO_EDITION: 'services',
    },
  },
})

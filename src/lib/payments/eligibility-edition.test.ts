import { describe, expect, it, vi, afterEach } from 'vitest'

/**
 * ⛔ ITS OWN FILE, AND THAT IS NOT TIDINESS. Proving the edition gate needs `vi.resetModules()` —
 * `IS_SERVICES` folds at module scope, so the only way to see the marketplace build is to re-import
 * the module under a stubbed env. Doing that inside eligibility.test.ts POLLUTED the worker: five
 * unrelated tests in agent-discovery and oauth went red in the full suite while passing in
 * isolation. Vitest isolates per FILE, so the surgery is quarantined here.
 *
 * ⚠️ THE FAILURE LOOKED LIKE A REGRESSION IN CODE I HAD NOT TOUCHED, which is the expensive part —
 * the tell was that they passed alone.
 */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const abroad = { kycVerified: true, nationality: 'GBR', residenceCountry: 'GBR', vietqrPayout: true }

describe('settlement is a SERVICES-edition feature', () => {
  it('⛔ the marketplace offers no rail at all, and validates none', async () => {
    /**
     * ⛔ RAISED BY A REVIEWER IN EVERY ROUND, and each time the answer was "the callers gate" —
     * true, because the only caller reached this through two IS_SERVICES checks. But a checkout is
     * exactly the caller about to be written. eno.vn is deliberately paymentless.
     * ⚠️ BOTH FUNCTIONS, because a checkout that VALIDATES a submitted rail calls `railAllowed`
     * directly and never touches the one that lists them — the bypass a reviewer found a moment
     * after the first gate landed.
     */
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    vi.resetModules()
    const fresh = await import('./eligibility')
    expect(fresh.availableRails(abroad, abroad)).toEqual([])
    for (const rail of ['crossmint', 'vietqr', 'paypal'] as const) {
      expect(fresh.railAllowed(rail, abroad, abroad), rail).not.toBeNull()
    }
  })

  it('the services edition offers them normally — so the gate is what differs, not the rules', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    vi.resetModules()
    const fresh = await import('./eligibility')
    expect(fresh.availableRails(abroad, abroad).length).toBeGreaterThan(0)
  })
})

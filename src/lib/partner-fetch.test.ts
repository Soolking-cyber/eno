import { describe, it, expect } from 'vitest'
import { mayReconcile } from './partner-fetch'

/**
 * ⛔ THE ONLY DECISION IN THE DAILY PARTNER JOB THAT CAN DESTROY A CATALOGUE. Everything else it
 * does moves one row's price or availability; this one answers "retire every product I did not see
 * in this fetch", and a wrong `true` marks a working shop's whole inventory sold.
 *
 * ⚠️ THE FIRST CUT OF THIS GATE COMPARED THE WRONG QUANTITIES — feed size against every held row —
 * and four reviewers independently showed it fails in BOTH directions. Each of those is a case here.
 */
const gate = (matched: number, activeHeld: number, complete = true) => mayReconcile({ matched, activeHeld, complete })

describe('mayReconcile', () => {
  /**
   * ⛔ AN INCOMPLETE READ RETIRES NOTHING, WHATEVER THE NUMBERS SAY. The adapters swallow a bad
   * page so one 503 cannot end a 3,596-product read — which means a partial catalogue comes back
   * looking exactly like a complete one. A shop that rate-limits at 02:00 ICT would otherwise mark
   * its unread tail sold every night, and those rows can never come back: the same tail fails again.
   */
  it('⛔ REFUSES OUTRIGHT WHEN THE FETCH REPORTED ITSELF INCOMPLETE', () => {
    expect(gate(3596, 3596, false)).toBe(false)   // a perfect-looking ratio is still not evidence
    expect(gate(100, 100, false)).toBe(false)
  })

  it('⛔ REFUSES ON A FETCH THAT RETURNED ALMOST NOTHING — a broken host, not an empty shop', () => {
    expect(gate(0, 3596)).toBe(false)
    expect(gate(19, 3596)).toBe(false)
  })

  /**
   * ⛔ THE DIRECTION THAT WOULD HAVE EMPTIED A STOREFRONT IN ONE NIGHT. A shop that re-issues its
   * ids — a WooCommerce re-import, a Sapo→Haravan migration, a template that stops emitting `sku`
   * so the slug fallback fires — returns a FULL, complete feed that matches zero held rows. Gated
   * on feed size that passes; gated on what actually matched, it cannot.
   */
  it('⛔ REFUSES A FULL FEED THAT MATCHES NOTHING WE HOLD — re-issued ids', () => {
    expect(gate(0, 3596, true)).toBe(false)
    expect(gate(12, 3596, true)).toBe(false)
  })

  /**
   * ⛔ AND THE DIRECTION THAT WOULD HAVE SILENTLY DISABLED THE PASS FOR THE ONE SHOP IT EXISTS FOR.
   * banghethanhly.vn's endpoint excludes its "Đã bán" category, so as products sell the HELD count
   * grows with sold rows while the feed shrinks — 7,286 sold of 11,124 puts the old feed-vs-all
   * ratio at 34%, under the floor for ever. Measuring active-only makes the same shop reconcilable.
   */
  it('⛔ IGNORES ALREADY-SOLD ROWS — the shop whose endpoint hides them stays reconcilable', () => {
    // 11,124 held of which 7,286 are already sold: 3,838 active, and the feed accounts for them.
    expect(gate(3838, 3838)).toBe(true)
    // The same numbers under the old feed-vs-ALL rule would have been 3838/11124 = 34% → refused.
  })

  it('⛔ REFUSES A PARTIAL SCRAPE THAT CLEARS THE ROW FLOOR BUT NOT THE FRACTION', () => {
    expect(gate(500, 3596)).toBe(false)   // 14% of what is active
    expect(gate(1797, 3596)).toBe(false)  // 49.97%
  })

  it('reconciles a read that accounts for what it is about to retire', () => {
    expect(gate(3596, 3596)).toBe(true)
    expect(gate(1798, 3596)).toBe(true)   // exactly 50%
  })

  /**
   * ⛔ `matched` CAN NEVER EXCEED `activeHeld` — the route computes it by filtering the active rows —
   * so a flat `matched >= 20` floor made reconciliation IMPOSSIBLE for any shop under twenty active
   * listings, for ever, however complete the read. The test that used to sit here asserted
   * `matched: 50, activeHeld: 0`, a state the route cannot produce, and so passed while the real
   * bound went untested. These are the reachable cases.
   */
  it('⛔ RECONCILES A SMALL SHOP — the floor must not exceed what the shop even has', () => {
    expect(gate(15, 15)).toBe(true)     // a complete read of a 15-listing shop
    expect(gate(14, 15)).toBe(true)     // one product genuinely gone
    expect(gate(7, 15)).toBe(false)     // half missing is not a read to retire on
  })

  /** Nothing active is held, so there is nothing to retire either way. */
  it('answers false when the storefront holds no active listings', () => {
    expect(gate(0, 0)).toBe(false)
  })

  it('takes its thresholds from the caller when the route tunes them', () => {
    expect(mayReconcile({ matched: 10, activeHeld: 100, complete: true }, { minRows: 5, minFraction: 0.05 })).toBe(true)
    expect(mayReconcile({ matched: 10, activeHeld: 100, complete: true }, { minRows: 50 })).toBe(false)
  })
})

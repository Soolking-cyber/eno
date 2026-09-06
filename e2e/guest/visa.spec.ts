import { test, expect } from '../helpers'

// The e-Visa surface as a logged-out guest. READ-ONLY — no case is started, nothing is
// mutated; the write endpoints are probed only to assert they REFUSE a guest. Ported to
// eno.vn 2026-07-23 (the visa-ownership row: eno.vn owns the applicant flow end to end but
// had no visa e2e — the forum's runner was the only place these gates were exercised, and
// the forum surface is legacy).

test.describe('Guest · e-Visa', () => {
  test('the handover bundle — a full PII dossier — is closed to guests', async ({ request }) => {
    const res = await request.get('/api/visa/admin/applications/00000000-0000-0000-0000-000000000000/bundle')
    expect([401, 403]).toContain(res.status())
  })

  test('the result upload — the applicant identity document path — is closed to guests', async ({ request }) => {
    const res = await request.post('/api/visa/admin/applications/00000000-0000-0000-0000-000000000000/result')
    expect([401, 403]).toContain(res.status())
  })

  test('case deletion is private to the signed-in owner', async ({ request }) => {
    const res = await request.delete('/api/visa/applications/00000000-0000-0000-0000-000000000000')
    expect([401, 403]).toContain(res.status())
  })

  test('the in-chat wizard cannot be advanced without a session', async ({ request }) => {
    const res = await request.post('/api/visa/applications/00000000-0000-0000-0000-000000000000/advance', {
      data: { step: 1 },
    })
    expect([401, 403]).toContain(res.status())
  })

  // ⚠️ The desk's storefront is reachable ONLY by its @handle — there is no stable /visa route
  // to key off. This spec pointed at `/eno_vietnam` until 2026-07-24, by which time the desk had
  // been renamed to `Eno Visa` / `@eno_visa`; the page 404'd and the assertion failed on the
  // LINK COUNT, which reads like "the desk has no products" and cost a real misdiagnosis (the
  // 14 products were live the whole time). So resolve the page first and say so plainly.
  /**
   * ⛔ `vietkite`, NOT `eno_visa` — THE DESK MOVED TO THE LICENSED PARTNER AND THIS DID NOT.
   * eno.vn's visa products are sold by VietKite (VISA_SHOP_OWNER_EMAIL=info@vietkite.com.vn), and
   * their storefront answers at /vietkite; /eno_visa has been a 404 since the repoint, so this
   * test has been red on production ever since — unnoticed, because the run was read through a
   * truncated log that printed the pass count and hid the failure line.
   *
   * ⚠️ A VISA STOREFRONT ON eno.vn IS INTENDED. eno.vn does not sell visa services; it hosts a
   * LICENSED PARTNER'S products as ordinary listings (owner, 2026-08-13). This test asserting that
   * they render to a guest is asserting the authorised state, not normalising a leak — the leak
   * this repo actually guards is eno.vn speaking about visas in its OWN voice, which the
   * resolveAlias block in next.config.ts enforces and edition-lint checks.
   *
   * ⚠️ The failure message below is the thing that made this a two-minute fix rather than a hunt,
   * and it was written by a past version of this test for exactly this event. Keep it: when the
   * desk moves again, it tells the next person what to change and, just as importantly, that a
   * 404 here is NOT evidence the desk has no products.
   */
  const VISA_DESK_HANDLE = 'vietkite'

  /**
   * ⛔ THE EXPECTED ANSWER DEPENDS ON WHICH EDITION IS BEING TESTED, AND IT IS NOT A SKIP.
   *
   * Measured 2026-09-06: `/vietkite` is 200 on eno.vn and 404 on eno.forum, both apex and www.
   * The 404 is the OWNER'S PRODUCT DECISION working, not a broken route — 2026-08-17: *"in
   * eno.forum vietkite and gmbr shouldnt be seen since we promote from our own storefront eno and
   * vice versa on eno.vn our own visa and itinerary services shouldnt be seen"* — enforced by
   * `SERVICES_HIDDEN_OWNER_EMAILS` (src/lib/edition-scope.ts), which the live 404 proves is now set
   * in the services environment.
   *
   * So this asserts both halves rather than skipping one. A blanket skip would have retired the
   * only test that watches the marketplace side, and would equally have hidden the day the forum's
   * hide-list is unset and a partner reappears where the owner said they must not.
   *
   * ⚠️ THE EDITION IS DERIVED FROM THE TARGET HOST, not from a flag, for the same reason
   * home.spec.ts derives the title: the suite has to be runnable against either deployment without
   * an edit.
   */
  test('the visa storefront renders to a guest on the marketplace, and is hidden on services', async ({ page }) => {
    /**
     * ⚠️ THE EDITION IS PROBED, NOT READ OFF THE HOSTNAME. `host.endsWith('eno.forum')` is false for
     * every localhost preview and CI server, so a services build served on :3000 would be asserted
     * as a marketplace and fail on a correct app (external review). `/visa` is the licensing
     * boundary itself: it does not exist in the marketplace bundle and does on services, which is
     * true on any host the suite is ever pointed at.
     */
    const visaProbe = await page.request.get('/visa')
    const services = visaProbe.status() !== 404
    const res = await page.goto(`/${VISA_DESK_HANDLE}`)

    if (services) {
      // The partner's storefront must not exist here. A 200 would mean the promotional boundary
      // the owner asked for has come undone.
      expect(
        res?.status(),
        `/${VISA_DESK_HANDLE} resolved on the services edition — SERVICES_HIDDEN_OWNER_EMAILS is ` +
        `probably unset in eno-services-env, and a partner is visible where the owner said they ` +
        `must not be.`,
      ).toBe(404)
      return
    }

    expect(
      res?.status(),
      `/${VISA_DESK_HANDLE} did not resolve — the visa desk was probably renamed. Check the ` +
      `handle of the storefront owned by VISA_SHOP_OWNER_EMAILS and update VISA_DESK_HANDLE; ` +
      `this is NOT evidence that the desk has no products.`,
    ).toBe(200)
    // The desk's storefront: header identity + at least one product card. Product NAMES are
    // owner-editable, so assert structure (listing links) rather than copy.
    await expect(page.locator('h1').first()).toBeVisible()
    expect(
      await page.locator('a[href^="/listings/"]').count(),
      'the desk storefront resolved but rendered no product links',
    ).toBeGreaterThan(0)
  })
})

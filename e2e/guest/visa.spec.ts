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

  test('the visa storefront renders its products to a guest', async ({ page }) => {
    const res = await page.goto(`/${VISA_DESK_HANDLE}`)
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

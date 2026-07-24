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
  const VISA_DESK_HANDLE = 'eno_visa'

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

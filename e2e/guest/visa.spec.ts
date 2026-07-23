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

  test('the visa storefront renders its products to a guest', async ({ page }) => {
    await page.goto('/eno_vietnam')
    // The desk's storefront: header identity + at least one product card. Product NAMES are
    // owner-editable, so assert structure (listing links) rather than copy.
    await expect(page.locator('h1').first()).toBeVisible()
    expect(await page.locator('a[href^="/listings/"]').count()).toBeGreaterThan(0)
  })
})

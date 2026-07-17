import { test, expect } from '@playwright/test'

// Authed lifecycle: the dashboard row actions on the seeded listing (verified=false, so it's only
// visible to its owner in the dashboard — never on the public feed). Mark sold → Relist is a full
// round-trip that leaves the fixture active; a re-seed also resets status='active' either way.
test.describe('seller · listing lifecycle (mark sold / relist)', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires standalone server + seeded listing (E2E_AUTHED_BASE)')

  test('mark sold then relist round-trips the status', async ({ page }) => {
    await page.goto('/dashboard/listings')
    await expect(page).not.toHaveURL(/\/signin/)
    await expect(page.getByText('E2E Test Item').first()).toBeVisible({ timeout: 10000 })

    // The seeded seller has exactly one listing, so the row actions are unambiguous. The UI flips
    // OPTIMISTICALLY, so wait for each status POST to actually land before the next click —
    // otherwise the two writes race server-side and can settle in the wrong order.
    const statusPost = () =>
      page.waitForResponse((r) => /\/api\/listings\/[^/]+\/status/.test(r.url()) && r.request().method() === 'POST')

    const markSold = page.getByRole('button', { name: /^(Mark sold|Đã bán)$/ })
    await expect(markSold).toBeVisible()
    await Promise.all([statusPost(), markSold.click()])

    // Flip → the Relist action replaces Mark sold.
    const relist = page.getByRole('button', { name: /^(Relist|Đăng lại)$/ })
    await expect(relist).toBeVisible({ timeout: 10000 })

    // Round-trip back so the fixture is left active.
    await Promise.all([statusPost(), relist.click()])
    await expect(page.getByRole('button', { name: /^(Mark sold|Đã bán)$/ })).toBeVisible({ timeout: 10000 })
  })
})

import { test, expect } from '@playwright/test'

// Seller dashboard (authed). Current model (2026-07-18): /dashboard is the unified HOME
// (forum-design card dashboard covering both eno properties — owner decision); each section
// is still its OWN /dashboard/* PAGE, and the account panel is a PERSISTENT left NAV RAIL.
// The old "/dashboard redirects to listings" model is GONE — only legacy ?tab= deep links
// still redirect.
test.describe('seller dashboard', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a standalone server + seeded seller (E2E_AUTHED_BASE)')

  test('/dashboard is the unified home behind the nav rail', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).not.toHaveURL(/\/signin/)
    // The home STAYS on /dashboard and greets the account (no redirect to a section).
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/)
    await expect(page.locator('h1')).toContainText(/Welcome|Chào/)
    // The persistent account rail (a non-modal dialog on desktop) links to the sections.
    const rail = page.locator('aside[role="dialog"]')
    await expect(rail).toBeVisible()
    await expect(rail.locator('a[href*="/dashboard/listings"]').first()).toBeVisible()
    await expect(rail.locator('a[href="/messages"]').first()).toBeVisible()
    // Legacy deep links still work.
    await page.goto('/dashboard?tab=listings')
    await expect(page).toHaveURL(/\/dashboard\/listings/)
  })

  test('the My listings section renders the seller\'s listings in main', async ({ page }) => {
    await page.goto('/dashboard/listings')
    await expect(page).not.toHaveURL(/\/signin/)
    const main = page.locator('#main')
    // The seeded listing shows (the seller sees their own regardless of moderation), or — if the
    // fixture is absent — the empty state. Either proves the section loaded, not a sign-in wall.
    await expect(
      main.getByText(/E2E Test Item/i)
        .or(main.getByText(/no listings yet|chưa có tin/i))
        .first(),
    ).toBeVisible({ timeout: 10000 })
  })
})

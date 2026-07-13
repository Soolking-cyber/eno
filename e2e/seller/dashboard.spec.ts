import { test, expect } from '@playwright/test'

// Seller dashboard (authed) — now the right-side ACCOUNT PANEL (user decision
// 2026-07-14): /dashboard redirects home and deep-opens the panel, so these
// specs assert the redirect contract + the panel's listings view.
test.describe('seller dashboard', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a preview deploy + seeded seller (E2E_AUTHED_BASE)')

  test('/dashboard opens the account panel on the listings view', async ({ page }) => {
    await page.goto('/dashboard?tab=listings')
    await expect(page).not.toHaveURL(/\/signin/)
    // Redirect lands home with the panel open as a dialog.
    const panel = page.locator('aside[role="dialog"]')
    await expect(panel).toBeVisible()
    // Listings view: a listing row action or the empty-state copy.
    await expect(
      panel.getByRole('button', { name: /edit|mark sold|sửa|đã bán/i }).first()
        .or(panel.getByText(/no listings|chưa có tin/i)),
    ).toBeVisible()
  })

  test('panel root shows the dashboard sections', async ({ page }) => {
    await page.goto('/dashboard')
    const panel = page.locator('aside[role="dialog"]')
    await expect(panel).toBeVisible()
    for (const name of [/settings|cài đặt/i, /disputes|khiếu nại/i, /help|trợ giúp/i]) {
      await expect(panel.getByText(name).first()).toBeVisible()
    }
  })
})

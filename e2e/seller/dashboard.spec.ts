import { test, expect } from '@playwright/test'

// Seller dashboard (authed). Runs only under the `seller` project, which exists solely when
// E2E_AUTHED_BASE points at a preview deploy with a seeded business test user. The skip guard
// is belt-and-suspenders so this can never execute against prod.
test.describe('seller dashboard', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a preview deploy + seeded seller (E2E_AUTHED_BASE)')

  test('dashboard loads with the listings view', async ({ page }) => {
    await page.goto('/dashboard')
    // Not bounced to sign-in → the storageState session is valid.
    await expect(page).not.toHaveURL(/\/signin/)
    // The dashboard h1 is the account/business name ("Your account" fallback) — not
    // the word "Dashboard"; assert the authed shell actually rendered its heading.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  })

  test('shows the seller’s own listings', async ({ page }) => {
    await page.goto('/dashboard')
    // At least one listing row or the empty-state — either is a valid rendered dashboard.
    await expect(
      page.getByRole('button', { name: /edit|mark sold|confirm/i }).first()
        .or(page.getByText(/no listings|chưa có tin/i)),
    ).toBeVisible()
  })
})

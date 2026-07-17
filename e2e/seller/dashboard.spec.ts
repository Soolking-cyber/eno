import { test, expect } from '@playwright/test'

// Seller dashboard (authed). Current model (2026-07-15/17): each section is its OWN /dashboard/*
// PAGE rendered in <main>, and the account panel is a PERSISTENT left NAV RAIL that links to them
// (replaces the old "panel IS the dashboard" drill-in). /dashboard redirects to /dashboard/listings.
test.describe('seller dashboard', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a standalone server + seeded seller (E2E_AUTHED_BASE)')

  test('/dashboard redirects into the listings section behind the nav rail', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).not.toHaveURL(/\/signin/)
    // The redirect lands on the listings section page.
    await expect(page).toHaveURL(/\/dashboard\/listings/)
    // The persistent account rail (a non-modal dialog on desktop) links to the sections.
    const rail = page.locator('aside[role="dialog"]')
    await expect(rail).toBeVisible()
    await expect(rail.locator('a[href*="/dashboard/listings"]').first()).toBeVisible()
    await expect(rail.locator('a[href="/messages"]').first()).toBeVisible()
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

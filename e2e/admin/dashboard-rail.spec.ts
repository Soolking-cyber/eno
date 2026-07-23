import { test, expect } from '@playwright/test'

// One-dashboard acceptance, admin side (owner spec 2026-07-18, doc item 10 —
// apps/forum/docs/CLAUDE_ONE_DASHBOARD_PROMPT.md): admins use the SAME rail
// (account-panel.tsx over dashboard-nav.tsx) with the role-gated Admin group
// APPENDED — never a second dashboard. Runs under the `admin` project only.
test.describe('admin dashboard rail', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a standalone server + seeded admin (E2E_AUTHED_BASE)')

  test('the Admin group is present with every queue row, in the one shared rail', async ({ page }) => {
    await page.goto('/admin')
    const rail = page.locator('aside[role="dialog"]')
    // Still exactly ONE rail — /admin/* reuses the shell, it does not mount its own.
    await expect(rail).toHaveCount(1)
    await expect(rail).toBeVisible()

    // Every admin queue row, by its internal href (the Admin group in dashboard-nav.tsx).
    // These render only once the server-computed isAdmin lands, so each expect auto-waits.
    for (const href of ['/admin', '/admin/disputes', '/admin/enforcement', '/admin/listings', '/admin/brands', '/admin/feedback']) {
      await expect(rail.locator(`a[href="${href}"]`), `admin rail row ${href}`).toHaveCount(1)
    }
    // The Visas operator row (aria-label "Visas"). Its href is /admin/visas once the queue is
    // ported into this app; until then dashboard-nav.tsx deliberately points it at the forum
    // operator tool — accept exactly those two targets, nothing else.
    const visas = rail.getByRole('link', { name: 'Visas', exact: true })
    await expect(visas).toHaveCount(1)
    const visasHref = await visas.getAttribute('href')
    expect(
      visasHref === '/admin/visas',
      `unexpected Visas row target: ${visasHref}`,
    ).toBe(true)

    // The regular Marketplace/Community groups stay present (role-gated, not path-switched):
    // the admin group is appended to the one rail, not swapped in for it. Help center is
    // the probe row — /dashboard/forum was REMOVED 2026-07-21 ("only help center") and
    // this line kept asserting the dead href (found by the 2026-07-23 authed recert).
    await expect(rail.locator('a[href="/dashboard/help"]')).toHaveCount(1)

    // The 'Admin' caption exists in the rail (visible once the rail is expanded — the
    // collapsed 72px column hides captions by design). The rail is HOVER-open since
    // 2026-07-23 (the pin toggle is gone, Session #4's sidebar rework) — the old
    // "Expand sidebar" button this spec clicked no longer exists.
    await rail.hover()
    await expect(rail.getByText('Admin', { exact: true })).toBeVisible()
  })

  test('/admin/visas responds for the admin with the visa queue', async ({ page }) => {
    // The ported queue page's real heading (root app, /admin/visas).
    const response = await page.goto('/admin/visas')
    expect(response?.status(), '/admin/visas should be a live page for the admin').toBe(200)
    await expect(page.getByText(/restricted area/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /visa queue/i })).toBeVisible()
  })
})

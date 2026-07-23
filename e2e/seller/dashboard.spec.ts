import { test, expect, devices } from '@playwright/test'

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
    // No dedicated home (owner 2026-07-18): /dashboard lands on the listings section,
    // which carries the greeting + marketplace stats + the availability button.
    await expect(page).toHaveURL(/\/dashboard\/listings/)
    await expect(page.locator('h1')).toContainText(/Hi|Chào/)
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

// ── One-dashboard acceptance (owner spec 2026-07-18, doc item 10) ─────────────────────
// apps/forum/docs/CLAUDE_ONE_DASHBOARD_PROMPT.md: there is exactly ONE dashboard — the
// eno.vn rail (account-panel.tsx rendering dashboard-nav.tsx). The rail is internal-only;
// the ONE deliberate exception is the explicitly-labelled "Open eno.forum" handoff row
// (doc item 5: a labelled tool handoff, not a disguised dashboard section).
const RAIL = 'aside[role="dialog"]'
// Every core rail row a plain seller must have, by exact href (dashboard-nav.tsx).
// NOT listed, by owner decision (see dashboard-nav.tsx comments):
//  · /dashboard/forum — Forum activity removed 2026-07-21 ("only help center")
//  · /dashboard/trips — Itinerary builder shelved 2026-07-23 (route stays, nav row gone)
//  · /dashboard/visa  — "My e-Visa" is gated on dash.hasVisa; the seeded seller has no
//    visa case, so its presence would couple this spec to the seed fixture
const CORE_HREFS = [
  '/dashboard/listings', '/messages', '/saved',
  '/dashboard/disputes',
  '/dashboard/settings', '/dashboard/help',
]
// The one sanctioned cross-site row, identified by its explicit label (EN/VI).
const HANDOFF_LABEL = /^(Open eno\.forum|Mở eno\.forum)$/

test.describe('one dashboard — rail integrity', () => {
  test.skip(!process.env.E2E_AUTHED_BASE, 'requires a standalone server + seeded seller (E2E_AUTHED_BASE)')
  const BASE = (process.env.E2E_AUTHED_BASE || 'http://localhost:3100').replace(/\/$/, '')

  test('exactly one rail; every core link is internal; no retired-repo targets', async ({ page }) => {
    await page.goto('/dashboard/listings')
    const rail = page.locator(RAIL)
    // ONE rail implementation, mounted once.
    await expect(rail).toHaveCount(1)
    await expect(rail).toBeVisible()

    // Every core row exists exactly once, with its internal eno.vn href.
    for (const href of CORE_HREFS) {
      await expect(rail.locator(`a[href="${href}"]`), `core rail row ${href}`).toHaveCount(1)
    }

    // Audit EVERY link in the rail: internal/same-origin only — the single exception is the
    // explicitly-labelled "Open eno.forum" handoff row. Nothing may point at the retired
    // Soolking-cyber/eno-forum repo or its hosts, and no core row may leave for eno.forum.
    const links: { href: string; label: string }[] = await rail.locator('a[href]').evaluateAll((els) =>
      els.map((a) => ({
        href: a.getAttribute('href') || '',
        label: (a.getAttribute('aria-label') || a.textContent || '').trim(),
      })),
    )
    expect(links.length).toBeGreaterThanOrEqual(CORE_HREFS.length)
    const origin = new URL(BASE).origin
    for (const l of links) {
      // Retired repo / legacy checkout must never be a navigation target (doc item 10, last bullet).
      expect(l.href, `retired repo target on "${l.label}"`).not.toMatch(/eno-forum|soolking-cyber/i)
      if (HANDOFF_LABEL.test(l.label)) continue // the labelled cross-site handoff row (doc item 5)
      expect(new URL(l.href, BASE).origin, `rail row "${l.label}" (${l.href}) must be internal`).toBe(origin)
      expect(l.href, `rail row "${l.label}" points at eno.forum`).not.toMatch(/^https?:\/\/(www\.)?eno\.forum/)
    }
  })

  test('Disputes → Help center change the right pane, never the shell', async ({ page }) => {
    await page.goto('/dashboard/listings')
    const rail = page.locator(RAIL)
    await expect(rail).toBeVisible()
    // Stamp the LIVE rail DOM node. A client-side route change keeps the node (stamp survives);
    // a full-document navigation or a shell remount produces a fresh node without the stamp —
    // exactly the "full dashboard replacement" the spec forbids.
    await rail.evaluate((el) => { (el as HTMLElement & { __e2eRailStamp?: boolean }).__e2eRailStamp = true })

    // The former hops (forum activity / trips / visa) are all gone from a plain seller's
    // rail — see the CORE_HREFS comment. Disputes and Help center are the surviving
    // always-present Community-side sections; each is asserted by a stable in-pane landmark.
    // (The Help h1 is runtime-translated in VI, so match the one word every VI phrasing of
    // "How can we help?" contains.)
    const sections: [href: string, marker: (main: import('@playwright/test').Locator) => import('@playwright/test').Locator][] = [
      ['/dashboard/disputes', (main) => main.getByRole('heading', { level: 1, name: /Disputes|Khiếu nại/ })],
      ['/dashboard/help', (main) => main.getByRole('heading', { level: 1, name: /How can we help|giúp/i })],
    ]
    for (const [href, marker] of sections) {
      await rail.locator(`a[href="${href}"]`).click()
      await expect(page).toHaveURL(new RegExp(href.replace(/\//g, '\\/')))
      // The right pane's content changed…
      await expect(marker(page.locator('#main'))).toBeVisible({ timeout: 15_000 })
      // …while the SAME rail node is still mounted (no shell replacement, still exactly one).
      await expect(rail).toHaveCount(1)
      expect(
        await rail.evaluate((el) => (el as HTMLElement & { __e2eRailStamp?: boolean }).__e2eRailStamp === true),
        `rail was remounted navigating to ${href}`,
      ).toBe(true)
    }
  })

  test('a seller never receives the Admin rail group', async ({ page }) => {
    await page.goto('/dashboard/listings')
    const rail = page.locator(RAIL)
    await expect(rail).toBeVisible()
    // Let the role-gated rows settle (the dashboard payload drives seller/business/admin rows):
    // the seeded seller's storefront row is the last role-dependent row to resolve.
    await expect(rail.getByRole('link', { name: /View storefront|Xem gian hàng/ })).toHaveCount(1)
    // Admin-ness is server-computed; a seller gets neither the caption nor any /admin/* row.
    await expect(rail.getByText('Admin', { exact: true })).toHaveCount(0)
    await expect(rail.locator('a[href^="/admin"]')).toHaveCount(0)
  })

  test('mobile: the Account tab opens a focus-trapped drawer with the same rows as desktop', async ({ browser }) => {
    // Same storageState as the project, but explicit contexts: real phone vs desktop.
    const state = 'e2e/.auth/seller.json'
    const desktop = await browser.newContext({ ...devices['Desktop Chrome'], baseURL: BASE, storageState: state })
    const mobile = await browser.newContext({ ...devices['Pixel 5'], baseURL: BASE, storageState: state })
    try {
      // Desktop: rail is persistent — collect its row labels once role rows have settled.
      const dPage = await desktop.newPage()
      await dPage.goto('/dashboard/listings')
      const dRail = dPage.locator(RAIL)
      await expect(dRail).toBeVisible()
      await expect(dRail.getByRole('link', { name: /View storefront|Xem gian hàng/ })).toHaveCount(1)
      const desktopLabels = await dRail.locator('nav a').evaluateAll((els) => els.map((a) => a.getAttribute('aria-label') || ''))

      // Mobile: closed by default; the bottom-nav Account tab opens it full-screen (eno:open-account).
      const mPage = await mobile.newPage()
      await mPage.goto('/dashboard/listings')
      // Wait for auth to resolve (the home greets the account) so the tab opens the rail
      // rather than falling back to a plain /dashboard navigation.
      await expect(mPage.locator('#main h1').filter({ hasText: /Hi|Chào/ })).toBeVisible()
      const mRail = mPage.locator(RAIL)
      await expect(mRail).toHaveCount(0) // launcher model: nothing mounted until opened
      await mPage.getByRole('link', { name: /^(Account|Tài khoản)$/ }).click()
      await expect(mRail).toBeVisible()
      // Full-screen MODAL on mobile (aria-modal), unlike the desktop non-modal rail.
      await expect(mRail).toHaveAttribute('aria-modal', 'true')

      // SAME item source (dashboard-nav.tsx): identical row labels, identical order.
      await expect(mRail.getByRole('link', { name: /View storefront|Xem gian hàng/ })).toHaveCount(1)
      const mobileLabels = await mRail.locator('nav a').evaluateAll((els) => els.map((a) => a.getAttribute('aria-label') || ''))
      expect(mobileLabels).toEqual(desktopLabels)
      // And on mobile the labels are visible text, not just icons. Help center is the
      // probe: Forum activity was REMOVED 2026-07-21 (owner: "only help center") and this
      // line kept asserting the dead label — the one spot Kyle's CORE_HREFS un-staling
      // (row-108) didn't reach.
      await expect(mRail.getByText(/Help center|Trung tâm trợ giúp/)).toBeVisible()

      // Focus is trapped inside the drawer: it moves in on open and Tab/Shift+Tab never escape.
      const focusInside = () => mPage.evaluate(() => !!document.activeElement?.closest('aside[role="dialog"]'))
      await expect.poll(focusInside, { message: 'focus should move into the drawer on open' }).toBe(true)
      for (let i = 0; i < 12; i++) {
        await mPage.keyboard.press('Tab')
        expect(await focusInside(), `focus escaped the drawer after ${i + 1} Tab presses`).toBe(true)
      }
      await mPage.keyboard.press('Shift+Tab')
      await mPage.keyboard.press('Shift+Tab')
      expect(await focusInside(), 'focus escaped the drawer on Shift+Tab').toBe(true)
    } finally {
      await desktop.close()
      await mobile.close()
    }
  })
})

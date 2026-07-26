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

/**
 * The [{href, label}] a nav surface actually offers, in DOM order.
 *
 * ⚠️ THE LABEL IS `children[1]`, NOT the anchor's text and NOT its aria-label, and both exclusions
 * are load-bearing:
 *   · the anchor's own text swallows the badge, so "Messages" reads as "Messages3" the moment the
 *     seeded seller has an unread — the two surfaces would then disagree for a reason that has
 *     nothing to do with the rows;
 *   · the desktop rail FOLDS the badge into aria-label on purpose ("Messages, 3 new", so screen
 *     readers hear the count), while the account page leaves the badge a separate element.
 * Comparing either one compares two different things. Both surfaces render
 * `<a><span>{icon}</span><span>{label}</span>…</a>` — verified against the rendered DOM of both
 * before this was written, not assumed — so the second child is the label on each.
 */
const rowsOf = (links: import('@playwright/test').Locator) =>
  links.evaluateAll((els) => els.map((a) => ({
    href: a.getAttribute('href') || '',
    label: (a.children[1]?.textContent || '').trim(),
  })))

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

  test('mobile: the Account tab is a DESTINATION offering the same rows as the desktop rail', async ({ browser }) => {
    // ⚠️ THIS TEST USED TO ASSERT A DRAWER, AND WAS RED ON EVERY RUN FOR THREE DAYS. It waited for
    // `aside[role="dialog"]` after tapping the mobile Account tab — but `4e31b06b` (2026-07-24,
    // "the Account tab is a destination, not an overlay") deleted that overlay ON PURPOSE, along
    // with the body lock, the focus trap and the `eno:open-account` event pair. A modal wearing a
    // tab's clothes could not be closed by Android hardware-back, had no URL, and could not be
    // linked to or reloaded.
    //
    // So the old assertions were not protecting anything — they were pinning a design that had been
    // deliberately removed, and a permanently red suite teaches everyone to skim past red. ⚠️ DO NOT
    // "repair" this by restoring the drawer.
    //
    // The invariant underneath it is still worth every line: mobile and desktop must offer the SAME
    // rows, from the SAME source (dashboard-nav.tsx → resolveNavGroups), in the SAME order. A second
    // hand-written list on either side would drift the first time a section is added. That claim is
    // re-expressed below against /dashboard/account as a page.
    const state = 'e2e/.auth/seller.json'
    const desktop = await browser.newContext({ ...devices['Desktop Chrome'], baseURL: BASE, storageState: state })
    const mobile = await browser.newContext({ ...devices['Pixel 5'], baseURL: BASE, storageState: state })
    try {
      // Desktop: rail is persistent — collect its rows once the role-gated ones have settled.
      const dPage = await desktop.newPage()
      await dPage.goto('/dashboard/listings')
      const dRail = dPage.locator(RAIL)
      await expect(dRail).toBeVisible()
      await expect(dRail.getByRole('link', { name: /View storefront|Xem gian hàng/ })).toHaveCount(1)
      const desktopRows = await rowsOf(dRail.locator('nav a'))

      // Mobile: the tab is a LINK to a route, and the route is where you end up.
      const mPage = await mobile.newPage()
      await mPage.goto('/dashboard/listings')
      // Wait for auth to resolve (the home greets the account) so the role-gated rows are present.
      await expect(mPage.locator('#main h1').filter({ hasText: /Hi|Chào/ })).toBeVisible()
      await mPage.getByRole('link', { name: /^(Account|Tài khoản)$/ }).click()
      await expect(mPage).toHaveURL(/\/dashboard\/account/)

      // ⚠️ A PAGE, NOT AN OVERLAY — asserted from both ends. The URL changed (above), and NO rail
      // dialog is mounted (below). Restoring the drawer would satisfy neither.
      await expect(mPage.locator(RAIL)).toHaveCount(0)
      // And because it is history, Back leaves — which is the single thing the overlay could not do
      // on Android, and the reason it was deleted.
      await mPage.goBack()
      await expect(mPage).toHaveURL(/\/dashboard\/listings/)
      await mPage.goForward()
      await expect(mPage).toHaveURL(/\/dashboard\/account/)

      // SAME item source: identical hrefs, identical labels, identical order.
      await expect(mPage.getByRole('link', { name: /View storefront|Xem gian hàng/ })).toHaveCount(1)
      const accountRows = await rowsOf(mPage.locator('#main li a'))
      expect(accountRows).toEqual(desktopRows)

      // ⚠️ NEITHER LIST MAY BE EMPTY OR UNLABELLED, and this guard is the point rather than padding:
      // both sides read `children[1]`, so a DOM reshuffle that broke the label extraction would make
      // BOTH sides `''` and the deepEqual above would pass vacuously against nothing at all.
      expect(desktopRows.length).toBeGreaterThanOrEqual(5)
      expect(desktopRows.filter((r) => !r.label || !r.href)).toEqual([])

      // On mobile the labels are VISIBLE TEXT, not icon-only chrome — checked through the rendered
      // box, so `opacity-0`/`display:none` cannot satisfy it. Help center is the probe: Forum
      // activity was REMOVED 2026-07-21 (owner: "only help center") and the old line kept asserting
      // the dead label.
      // ⚠️ SCOPED TO #main. Unscoped this is a strict-mode violation, because the app FOOTER carries
      // its own "Help center" link to /help — invisible while the drawer wrapped the assertion, and
      // the first thing to bite once the rows live on an ordinary page.
      await expect(mPage.locator('#main').getByText(/Help center|Trung tâm trợ giúp/)).toBeVisible()
      //
      // ⚠️ A REAL BOX, NOT `> 0`, and the threshold is measured rather than guessed. Every label on
      // this page renders 289×20 (they are `flex-1`), so 40×10 has enormous headroom — while `> 0`
      // would have waved through `sr-only`, which is exactly how "icon-only with a screen-reader
      // label" regresses in practice: the accessible name survives, so the role queries above stay
      // green, and only the geometry gives it away.
      const labelBoxes = await mPage.locator('#main li a > span:nth-child(2)').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height) }
        }))
      expect(labelBoxes.length).toBe(accountRows.length)
      expect(labelBoxes.filter((b) => !b.text || b.w < 40 || b.h < 10)).toEqual([])

      // A seller is not an admin, on either surface. Admin-ness is server-computed, so this is a
      // real gate rather than a styling check.
      await expect(mPage.locator('#main a[href^="/admin"]')).toHaveCount(0)
      await expect(mPage.locator('#main section h2').filter({ hasText: /^Admin$/i })).toHaveCount(0)
    } finally {
      await desktop.close()
      await mobile.close()
    }
  })
})

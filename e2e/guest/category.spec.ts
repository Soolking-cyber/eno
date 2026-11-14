import { test, expect } from '../helpers'

// Guest category page. Each card is a real stretched <a href="/listings/<id>"> (data-card-link):
// a plain left-click preventDefaults and does client-side navigation (onOpen), while
// modifier/middle click falls through to the href so open-in-new-tab works. We open one by
// clicking the card link and assert the client-side navigation to a listing detail.
test.describe('Guest · category (/c/electronics)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/c/electronics') })

  test('renders the category with listings', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /Electronics in Vietnam/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
  })

  test('exposes district facets', async ({ page }) => {
    // District chips link to /c/<category>/<district-slug>. The slug depends on the real
    // district/ward name (e.g. "Phường An Khánh" → phuong-an-khanh), NOT a seed-era
    // "district-N" pattern — so match any category sub-page link. If a thin catalog has none,
    // skip rather than fail (the mechanism, not seed density, is what's under test).
    // ⚠️ ON /c/rentals, NOT /c/electronics (2026-09-29): "By area" now renders only where three or
    // more places hold five or more listings (category-copy.ts `byAreaChips`, C1-LEDE), and
    // electronics — almost all linked stock without a district — printed one chip for one listing.
    // Left on electronics this test would skip forever; rentals is where the row earns its place.
    await page.goto('/c/rentals')
    // ⚠️ THE VISIBLE ONES (batch 93, 2026-11-14): the same district links are in the HTML twice — the "By area" row (from sm)
    // and, on a phone, the sort strip's one control row — and CSS shows one copy per width. The DOM's first match is the
    // row, which a phone does not display.
    const chips = page.locator('a[href^="/c/rentals/"]').filter({ visible: true })
    // ⚠️ WAIT FOR THE PAGE BODY BEFORE DECIDING THERE ARE NONE. The h1 is the LAYOUT's and paints
    // above the loading boundary, while the chips stream in with the page — a count taken in that
    // window read 0 and skipped a live 29-chip row (twice in six runs against a dev server).
    await chips.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
    if ((await chips.count()) === 0) test.skip(true, 'no district inventory in this category yet')
    await expect(chips.first()).toBeVisible()
  })

  test('clicking a card opens the listing detail (client routing)', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
    // Two things to assert: (1) the card exposes a real stretched anchor with the listing href
    // (SEO + open-in-new-tab, which the old div[role=button] never had); (2) clicking the photo —
    // the dominant tap area — navigates client-side. The photo sits ABOVE the anchor and carries
    // its own onClick, so we click its centre by coordinate (a plain locator.click races the
    // hover-expand animation's actionability check).
    const link = page.locator('a[data-card-link]').first()
    await expect(link).toHaveAttribute('href', /\/listings\//)
    const photo = page.locator('[data-protected]').first()
    // ⛔ SCROLL IT INTO VIEW FIRST, AND THIS IS NOT TEST HYGIENE — IT WAS A FALSE FAILURE WITH A
    // REAL FINDING BEHIND IT. On a Pixel 5 the first card's photo begins so far down the category
    // page that its CENTRE sits underneath the fixed bottom navigation: `elementsFromPoint` at
    // that coordinate returned the nav, and the click went to /saved. The click is by coordinate
    // (see above), so an off-screen or covered centre silently tests something else.
    await photo.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const box = await photo.boundingBox()
    if (!box) throw new Error('no listing card photo found')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page).toHaveURL(/\/listings\//)
  })
})

/**
 * ⛔ /c/rentals ON A PHONE: ONE CONTROL ROW (UI climb batch 93, owner decision 5, 2026-11-14). The area chips ride the sort
 * strip (Relevance · Filters · Map · every district, one swipe row), "By area:" and "All" go, and the count moves to the right
 * end of the heading line. From sm the page is as it was. Skips where no strip renders (0–1 rentals).
 */
test.describe('Guest · /c/rentals one control row (batch 93)', () => {
  async function openRentals(page: import('@playwright/test').Page) {
    await page.goto('/c/rentals')
    const strip = page.locator('[data-pinned-strip]')
    await strip.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
    if ((await strip.count()) === 0) test.skip(true, 'no sort strip: 0–1 rentals live')
    await page.locator('[data-listings-ready="true"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
    return strip
  }

  test('phone: the areas ride the sort strip, and the count ends the heading line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'phone-only: from sm the "By area" row stays')
    const strip = await openRentals(page)
    await expect(page.getByText('By area:', { exact: true })).toBeHidden()
    await expect(page.locator('main [aria-current="page"]', { hasText: /^All$/ })).toBeHidden()
    // The first district link a phone shows, and the map link, are the strip's.
    const firstArea = page.locator('a[href^="/c/rentals/"]').filter({ visible: true }).first()
    await expect(firstArea).toBeVisible()
    expect(await firstArea.evaluate((a) => !!a.closest('[data-pinned-strip]'))).toBe(true)
    await expect(strip.locator('a[href*="view=map"]')).toBeVisible()
    expect(await page.locator('main a[href*="view=map"]').filter({ visible: true }).count()).toBe(1)
    // The count: on the heading line, at its right end (the 12px gutter), not in the strip; the page never scrolls sideways.
    const count = page.locator('[data-heading-count]')
    await expect(count).toBeVisible()
    await expect(count).toHaveText(/\d/)
    const geo = await count.evaluate((el) => {
      const c = el.getBoundingClientRect()
      const h = (el.nextElementSibling as HTMLElement).getBoundingClientRect()
      return {
        right: c.right, top: c.top, bottom: c.bottom, hTop: h.top, hBottom: h.bottom, hRight: h.right, left: c.left,
        inStrip: !!el.closest('[data-pinned-strip]'), w: innerWidth, sw: document.documentElement.scrollWidth,
      }
    })
    expect(Math.abs(geo.right - (geo.w - 12))).toBeLessThanOrEqual(1)
    expect(geo.top).toBeGreaterThanOrEqual(geo.hTop - 1)
    expect(geo.bottom).toBeLessThanOrEqual(geo.hBottom + 1)
    expect(geo.hRight).toBeLessThanOrEqual(geo.left - 11)
    expect(geo.inStrip).toBe(false)
    expect(geo.sw).toBeLessThanOrEqual(geo.w)
  })

  test('desktop: unchanged — "By area:" with All, no heading count, the count sentence under the strip', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'desktop-only: the phone has its own test above')
    await openRentals(page)
    await expect(page.getByText('By area:', { exact: true })).toBeVisible()
    await expect(page.locator('main [aria-current="page"]', { hasText: /^All$/ })).toBeVisible()
    await expect(page.locator('[data-heading-count]')).toBeHidden()
    await expect(page.getByText(/^(?:Showing [\d,]+ of [\d,]+ listings\.|[\d,]+ listings?\.)$/)).toBeVisible()
  })
})

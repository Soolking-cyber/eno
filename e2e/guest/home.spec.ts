import { test, expect } from '../helpers'

// Guest homepage — loads and exposes its core surfaces. `test` (from ../helpers) pre-seeds the
// privacy-preserving consent choice so the first-visit modal never blocks interaction.
test.describe('Guest · homepage', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('loads with title and hero', async ({ page }) => {
    await expect(page).toHaveTitle(/eno\.vn/i)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('shows the search box and primary CTAs', async ({ page }) => {
    // ⚠️ THE SEARCH BOX IS THE HEADER'S NOW (owner, 2026-08-03: "move main searchbar to top navbar").
    // The hero bar that carried `hero.searchPlaceholder` ("Search motorbikes, apartments…") was
    // deleted, so that string is no longer on any page — matching it here failed against a homepage
    // that was working perfectly. `:visible` + .first() because the header renders a mobile and a
    // desktop input and BOTH are in the DOM; a bare locator trips Playwright's strict mode.
    await expect(page.locator('input[placeholder*="Find products"]:visible').first()).toBeVisible()
    // Post + Sign-in routes are wired; on desktop they're in the header, on mobile the bottom
    // nav. Assert a VISIBLE Post affordance (viewport-agnostic) and that a Sign-in link exists.
    await expect(page.locator('a[href="/post"]:visible').first()).toBeVisible()
    await expect(page.locator('a[href="/signin"]').first()).toBeAttached()
  })

  test('renders category navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Electronics/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Vehicles/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Property/ })).toBeVisible()
  })

  test('shows home rails', async ({ page }) => {
    // ⚠️ "Latest listings" is an always-rendered sr-only <h2> (listings-explorer.tsx:1704),
    // so heading-only assertions passed with EVERY rail removed — proven by deleting them
    // and watching this test stay green. A rail is its CARDS; assert those.
    const trending = page.getByRole('heading', { name: /Trending now/i })
    const latest = page.getByRole('heading', { name: /Latest listings/i })
    await expect(trending.or(latest).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
  })

  test('content images decode (no broken cards)', async ({ page }) => {
    // Wait for a card to render, then measure the largest VISIBLE image — a broken image
    // reports naturalWidth === 0 even though the <img> exists.
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
    const naturalWidth = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 60 && r.height > 60 })
      if (!vis.length) return -1
      const big = vis.reduce((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height > ar.width * ar.height ? b : a })
      return big.naturalWidth
    })
    expect(naturalWidth, 'largest visible image should have decoded').toBeGreaterThan(0)
  })
})

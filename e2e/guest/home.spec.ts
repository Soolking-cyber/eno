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
    await expect(page.getByPlaceholder(/Search motorbikes/i)).toBeVisible()
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
    const trending = page.getByRole('heading', { name: /Trending now/i })
    const latest = page.getByRole('heading', { name: /Latest listings/i })
    await expect(trending.or(latest).first()).toBeVisible()
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

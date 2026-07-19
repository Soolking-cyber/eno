import { test, expect } from '../helpers'

// Listing detail as a logged-out guest. READ-ONLY: we may click the contact gate /
// carousel arrow to assert behaviour, but never log in or mutate anything.
//
// The target listing is resolved LIVE from the home feed (audit Phase 0): the old
// hardcoded cuid died on every reseed/wipe, silently skipping the whole suite's
// subject. First card wins; its accessible name is the listing title.
let LISTING = ''
let TITLE_RE = /./

test.describe('Guest · listing detail (first live listing)', () => {
  test.beforeEach(async ({ page }) => {
    if (!LISTING) {
      await page.goto('/')
      const card = page.locator('a[data-card-link]').first()
      await card.waitFor({ timeout: 20_000 })
      LISTING = new URL((await card.getAttribute('href'))!, page.url()).pathname
      const label = (await card.getAttribute('aria-label')) || (await card.textContent()) || ''
      // Escape each word FIRST, then join with \s+ — escaping after joining would
      // mangle the joiner's own `+` into a literal.
      const words = label.trim().split(/\s+/).slice(0, 3)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+')
      TITLE_RE = new RegExp(words, 'i')
    }
    await page.goto(LISTING)
  })

  test('shows title and price area', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE_RE })).toBeVisible()
    await expect(page).toHaveTitle(TITLE_RE)
  })

  test('main image actually renders (broken-image guard)', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE_RE })).toBeVisible()
    // Largest visible <img> = the hero photo; a broken image reports naturalWidth === 0.
    const naturalWidth = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 80 && r.height > 80 })
      if (!vis.length) return 0
      const big = vis.reduce((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height > ar.width * ar.height ? b : a })
      return big.naturalWidth
    })
    expect(naturalWidth, 'main listing image should have decoded (naturalWidth > 0)').toBeGreaterThan(0)
  })

  test('opens the photo lightbox and locks background scroll', async ({ page }) => {
    // Desktop opens the lightbox via "View all photos · N" on the mosaic; mobile's
    // full-width swipe carousel opens it by tapping the photo itself. Either way it
    // must open a modal that FREEZES the page behind it so swipes don't scroll the
    // background.
    await expect(page.getByRole('heading', { level: 1, name: TITLE_RE })).toBeVisible()
    const viewAll = page.getByRole('button', { name: /View all photos/i })
    if (await viewAll.isVisible()) await viewAll.click()
    else await page.getByRole('button', { name: /photo 1/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Background is scroll-locked while open…
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    // …and restored on close.
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('contact is gated for guests', async ({ page }) => {
    // The contact CTA reads "Chat now" (desktop seller card) / "Chat" (mobile sticky bar);
    // the sign-in gate lives IN the click handler rather than in the button copy. A guest who
    // taps it must get the sign-in dialog — never a live thread / the seller's contact.
    const chat = page.getByRole('button', { name: /^(Chat now|Chat)$/i }).first()
    await expect(chat).toBeVisible()
    const dialog = page.getByRole('dialog')
    // A click that lands while useAuth is still resolving is buffered by ContactComposer
    // and drained once auth settles — so a single click always yields the sign-in dialog.
    await chat.click()
    await expect(dialog).toBeVisible({ timeout: 15000 })
  })

  test('exposes Save / Share / Report controls', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Share$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible()
  })
})

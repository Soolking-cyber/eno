import { expect, test, dismissOverlays } from '../helpers'

/**
 * WHERE THE LISTING PAGE'S BUY ACTION LANDS, ON THE SCREENS THAT KEPT HIDING IT.
 *
 * Both claims below are made with CSS alone — an `order-*` on the market-price band, and the column
 * grid starting at md instead of lg — so nothing in tsc, the unit suite or the a11y scan can see them,
 * and a future reorder would silently undo either one. Geometry is the only proof.
 *
 * ⚠️ NO ABSOLUTE CTA y ON A PHONE, for the reason icons-and-fold.spec.ts records: everything between
 * the gallery and the CTA is listing CONTENT (title lines, chips that wrap), so a fixed y measures the
 * seed rather than the layout. What is asserted is ORDER on phones, and the first-screen claims on the
 * tablet/landscape layouts, where the side-by-side grid makes them properties of the layout itself.
 */
type Page = import('@playwright/test').Page

const topOf = async (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))

/** Open a real listing off the live feed — pinning a cuid rots into a false pass after a reseed. */
const openAListing = async (page: Page) => {
  await page.goto('/')
  await dismissOverlays(page)
  const first = page.locator('a[data-card-link="true"]').first()
  await first.waitFor({ state: 'attached' })
  await page.goto((await first.getAttribute('href'))!)
  await dismissOverlays(page)
  await page.locator('h1').first().waitFor()
}

test.describe('Guest · PDP market band sits below the CTA on phones', () => {
  /**
   * The market-price gauge used to sit between the price and the title — ~81px of the phone fold, all
   * spent above 'Buy on …', which then landed under the floating tab bar on a 390x844 phone. It now
   * paints right AFTER the contact block. Only listings with enough comparables have a band, so this
   * looks for one among Apple phones (the densest shelf) and skips, rather than passes, without one.
   */
  test('the market band is painted after the contact block', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'mobile paint order only')
    const res = await page.request.get('/api/listings?category=electronics&subcategory=phones-tablets&brand=apple&limit=24')
    const ids = ((await res.json()).listings ?? []).map((l: { id: string }) => l.id) as string[]
    let found = false
    for (const id of ids.slice(0, 12)) {
      await page.goto(`/listings/${id}`)
      await dismissOverlays(page)
      if (await page.locator('[data-market-price]').count()) { found = true; break }
    }
    test.skip(!found, 'no listing with a market band')
    const [contact, band] = await Promise.all([topOf(page, '#contact'), topOf(page, '[data-market-price]')])
    expect(band, 'the market band must paint AFTER the CTA block — above it, it pushes the CTA under the tab bar')
      .toBeGreaterThan(contact)
  })
})

/**
 * THE TWO-COLUMN GRID FROM md. The media switched to its desktop mount at md long before the columns
 * did, so a tablet stacked a ~770px square gallery over the title and the CTA fell below the fold.
 * Chromium only (the guest-desktop project) — the viewports are set per describe.
 */
test.describe('Guest · PDP two columns on a portrait tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true })
  test('the title sits beside the gallery and the CTA starts in the first screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'one browser is enough for a class-only layout')
    await openAListing(page)
    const galleryBottom = await page.locator('[data-protected] >> visible=true').first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().bottom + window.scrollY))
    const h1 = await topOf(page, 'h1')
    expect(h1, 'the H1 must sit BESIDE the gallery, not under it').toBeLessThan(galleryBottom)
    // 136 = the floating tab bar's 72px footprint (it shows up to 1023px) plus 64px for the CTA itself.
    expect(await topOf(page, '#contact'), 'the contact block must start in the first screen').toBeLessThan(1180 - 136)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal scroll').toBeLessThanOrEqual(820)
  })
})

test.describe('Guest · PDP on a landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  test('the contact block starts in the first screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'one browser is enough for a class-only layout')
    await openAListing(page)
    expect(await topOf(page, '#contact'), 'at 844x390 the stacked layout put the CTA ~1,200px down').toBeLessThan(390)
  })
})

test.describe('Guest · PDP desktop columns are unchanged at lg', () => {
  test.use({ viewport: { width: 1024, height: 768 } })
  test('the buy box is to the right of the gallery', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'desktop layout')
    await openAListing(page)
    const galleryRight = await page.locator('[data-protected] >> visible=true').first().evaluate((el) => el.getBoundingClientRect().right)
    const h1Left = await page.locator('h1').first().evaluate((el) => el.getBoundingClientRect().left)
    expect(h1Left).toBeGreaterThan(galleryRight)
  })
})

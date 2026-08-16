import { expect, test, dismissOverlays } from '../helpers'

/**
 * THE TWO THINGS EVERY OTHER SUITE IS STRUCTURALLY BLIND TO.
 *
 * ⚠️ ICONS. Every glyph in the app is now two `<use>` elements into one external sprite
 * (scripts/gen-icons.mjs). That means a 404 on `/icons/glyphs.svg` draws NOTHING — silently. There
 * is no error, no exception and no failing assertion anywhere: the glyphs are all `aria-hidden`, so
 * the a11y scan cannot see them, tsc cannot see them, and 3,687 unit tests cannot see them. A build
 * with no icons at all ships green. Three independent reviewers landed on this same blind spot, so
 * the sprite gets its own guard.
 *
 * ⚠️ THE MOBILE FOLD. The PDP's "Chat now" CTA used to render at y=808 on a 390x844 phone, with a
 * fixed tab bar owning the last 72px — i.e. never visible without scrolling, on the button that IS
 * the conversion. It was fixed by CSS `order` alone, which no test asserts and any future reorder
 * can silently undo. Geometry is the only thing that proves it, so this asserts geometry.
 */
test.describe('Guest · icon sprite', () => {
  test('the sprite is served, and it is the file the glyphs reference', async ({ page }) => {
    await page.goto('/')
    const href = await page.locator('use').first().getAttribute('href')
    /**
     * ⚠️ THE HREF CARRIES A CACHE-BUSTING QUERY: `/icons/glyphs-core.svg?v=<hash>#Name-r`. The
     * first version of this test asserted `#` immediately after `.svg` and would have gone red on
     * its first CI run — the query stamp was added later in the same change, and two reviewers
     * caught the contract drifting apart across three files. Assert the FILE and allow the stamp.
     *
     * ⛔ AND THE FILE IS `glyphs-core`, NOT `glyphs`, SINCE THE SPRITE WAS SPLIT (2026-08-14).
     * One file became two — `glyphs-core.svg` for the 39 glyphs measured on first paint and
     * `glyphs-rest.svg` for the other 204 — and this assertion was not updated with it. It has
     * been failing on production ever since, unnoticed, because the run was being read through a
     * truncated log that showed the pass count and hid the failure line. The transitional
     * `glyphs.svg` still exists for edge-cached HTML, so the OLD pattern would still have found a
     * live file: this test could only ever have caught the rename by asserting the name.
     */
    expect(href, 'a glyph should reference the sprite').toMatch(/^\/icons\/glyphs-(core|rest)\.svg(\?[^#]*)?#/)
    const res = await page.request.get(href!.split('#')[0]!)
    expect(res.status(), 'the sprite must exist — a 404 here blanks every icon on the site').toBe(200)
    expect(res.headers()['content-type']).toContain('svg')
  })

  test('a glyph actually paints — a resolved <use> has a real box', async ({ page }) => {
    await page.goto('/')
    await dismissOverlays(page)
    // An unresolved <use> (missing file, missing symbol id, bad viewBox) collapses to zero size.
    // ⚠️ `.first()` is the header's search glyph, which is above the fold on every page and every
    // breakpoint — deliberately not a glyph that a layout change could scroll out of existence.
    const box = await page.locator('use').first().boundingBox()
    expect(box?.width ?? 0, 'a resolved symbol paints; an unresolved one is 0x0').toBeGreaterThan(4)
  })
})

test.describe('Guest · mobile PDP fold', () => {
  /** Open a real listing off the live feed — pinning a cuid rots into a false pass after a reseed. */
  const openAListing = async (page: import('@playwright/test').Page) => {
    await page.goto('/')
    await dismissOverlays(page)
    const first = page.locator('a[data-card-link="true"]').first()
    await first.waitFor({ state: 'attached' })
    await page.goto((await first.getAttribute('href'))!)
    await dismissOverlays(page)
  }
  const topOf = async (page: import('@playwright/test').Page, selector: string) =>
    page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))

  /**
   * ⚠️ THE ORDER IS THE DEVICE-INDEPENDENT CLAIM, AND IT IS THE ONE THAT GUARDS THE ACTUAL CHANGE.
   * The fold was fixed purely with CSS `order`: the breadcrumb and the mobile shop row moved from
   * above the gallery to below `#contact`. Nothing in tsc, unit tests or the a11y scan can see an
   * `order-*` value, and a future reorder would silently push the CTA back under the tab bar.
   */
  test('the CTA is painted BEFORE the shop row and the breadcrumb', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'mobile paint order only')
    await openAListing(page)
    const [gallery, contact, shop, crumb] = await Promise.all([
      topOf(page, '[data-protected]'), topOf(page, '#contact'),
      topOf(page, 'main .order-7.md\\:hidden'), topOf(page, 'nav[aria-label="Breadcrumb"]'),
    ])
    expect(gallery, 'the gallery leads the page').toBeLessThan(contact)
    expect(contact, 'the CTA must come before the seller row — moving it after is what buys the fold')
      .toBeLessThan(shop)
    expect(contact, 'the CTA must come before the breadcrumb').toBeLessThan(crumb)
  })

  /**
   * ⚠️ THE CHROME ABOVE THE GALLERY IS THE THING WORTH PINNING — NOT THE CTA'S ABSOLUTE y, WHICH IS
   * NOT A PROPERTY OF THE LAYOUT AT ALL. That was the first version of this test and it failed for
   * an instructive reason: everything between the gallery and the CTA is listing CONTENT (title
   * lines, the market-price gauge, condition/location/posted badges that wrap), so the CTA lands at
   * y=682 on a one-line title and y=810 on VietKite's two-line "Vietnam E-Visa — Multiple Entry — 1
   * Business Day". A guard that green-lights one listing and reddens another is measuring the seed,
   * not the page.
   *
   * What IS a layout property, and what actually changed here, is how much of the fold is spent
   * before the product appears: it was 270px of a 772px usable budget — 35% — with a breadcrumb and
   * a seller row stacked over a full-bleed square gallery. Now it is the banner plus the header.
   * 150 is that measured 144 plus room for a rounding/font difference, and it is listing-independent,
   * so this fails exactly when someone puts a block back above the media.
   *
   * ⚠️ WHAT THIS DELIBERATELY DOES NOT CLAIM: that the CTA clears the tab bar on every device. It
   * does at 390x844 for a one-line title; it does not on the project's Pixel 5 (393x727), where the
   * budget is 655. The missing pixels are the 64px MoIT test-operation banner — temporary, and the
   * owner's to remove — and they are not worth buying by shrinking the square gallery (an explicit
   * owner decision, 2026-07-23) or by re-adding a sticky bar (`PdpMobileBar` was deleted on purpose).
   */
  test('the fold is not spent on chrome above the gallery', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'fold geometry is a phone-viewport claim')
    await page.setViewportSize({ width: 390, height: 844 })
    await openAListing(page)
    const galleryTop = await topOf(page, '[data-protected]')
    expect(galleryTop,
      'the media must start right under the header — it was 270 with the breadcrumb and shop row above it',
    ).toBeLessThanOrEqual(150)
  })
})

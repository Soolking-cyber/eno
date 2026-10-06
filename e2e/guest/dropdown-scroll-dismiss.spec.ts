import { test, expect } from '../helpers'

// Regression cover for the owner's 2026-08-16 report: "when i open dropdown and scroll up dropdown
// persists and not autocloses in some dropdowns". Base UI's Positioner RE-POSITIONS a popup on
// scroll and never dismisses it, so a non-modal Popover rides the page down and reads as stuck.
//
// ⚠️ THE FACET BAR ONLY MOUNTS AT `/?category=<slug>` — never at a bare `/`, and there is no
// `/listings` browse route to fall back to. A spec that navigates anywhere else finds no trigger
// and passes vacuously, which is exactly how this class of bug survives a green suite.
//
// ⚠️ THE GESTURE MUST BE `mouse.wheel`, NOT `window.scrollTo`. The fix listens for `wheel` and
// `touchmove` — the USER-INITIATED events — precisely so a programmatic scroll (the browser
// bringing a trigger into view, or the iOS keyboard shifting the document) cannot dismiss a popup.
// A `scrollTo`-driven test would therefore report a failure that no user can reproduce.
//
// ⚠️ ON A PHONE THE PRICE PANEL IS NOT A POPOVER (E-FILTER-SHEET, 2026-09-29). Below `sm` (useIsPhone)
// price-range-filter.tsx renders a ui/drawer bottom sheet instead: MODAL, full width and pinned to the
// viewport's bottom edge, so there is no anchored popup left to ride the page — the defect this file
// exists for cannot occur there, and a wheel over its scrim neither dismisses it nor moves the page
// (measured). The popover case therefore runs on guest-desktop only, unchanged, and guest-mobile
// asserts the sheet contract instead: the phone never renders the popover, and the Price pill opens a
// full-width sheet on the bottom edge that closes through its own action.

// ⚠️ A LIVE SHELF, NOT `vehicles`: vehicles is RETIRED (src/lib/retired-categories.ts — 2 live rows), and on
// 2026-10-05 this spec's failure there right after a cold deploy was read as "UX3 removed the phone Price pill".
// It had not: the pill was present, the FacetBar (an ssr:false chunk) had simply not mounted in time. Electronics
// carries the full live bar (Filter, Price, Area, condition, Good price) and enough rows to scroll. The specs
// navigate on `domcontentloaded` and use the FacetBar's own mount as the readiness signal: the full `load` event
// waits on every image of a big shelf and once exceeded the 20 s goto budget under parallel load (2026-10-06).
const CATEGORY_ROUTE = '/?category=electronics'
const POPOVER = '[data-slot="popover-content"]'
const SHEET = '[data-slot="drawer-popup"]'

/**
 * The FacetBar is `dynamic(…, { ssr: false })` with a painted FacetBarFallback (aria-hidden, inert, no data-slot)
 * until its chunk mounts. Wait for the REAL bar's Filter control first, so an unmounted bar reports as such —
 * not as "the Price pill is missing", the misreading this replaces. (The fallback carries no marker, so the
 * message names both causes rather than guessing.)
 */
async function facetBarMounted(page: import('@playwright/test').Page) {
  await expect(
    page.locator('[data-slot="drawer-trigger"],[data-slot="popover-trigger"]', { hasText: /^\s*(Filter|Bộ lọc)/ }).filter({ visible: true }).first(),
    'no FacetBar Filter control on screen — usually its ssr:false chunk has not mounted (FacetBarFallback, an inert picture, is still painted: a load or deploy-skew problem); if the real bar IS mounted, its Filter control is missing',
  ).toBeVisible({ timeout: 15_000 })
}

test.describe('Guest · open popups dismiss on a user scroll', () => {
  test('the facet bar price popover closes when the page is wheeled', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'guest-mobile', 'phone: Price is a modal bottom sheet, not a popover — covered by the next test')
    await page.goto(CATEGORY_ROUTE, { waitUntil: 'domcontentloaded' })
    await facetBarMounted(page)

    const trigger = page.locator('[data-slot="popover-trigger"]', { hasText: /price|giá/i }).first()
    await expect(trigger, 'the facet bar mounted but has no Price pill').toBeVisible()
    await trigger.click()
    await expect(page.locator(POPOVER)).toBeVisible()

    // Wheel over the page, NOT over the popup: a gesture that starts inside a popup belongs to
    // that popup (a long list scrolling itself must never dismiss itself).
    await page.mouse.move(40, 600)
    await page.mouse.wheel(0, 450)

    await expect(page.locator(POPOVER)).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollY), 'the page should have actually moved').toBeGreaterThan(0)
  })

  test('on a phone the price pill opens a full-width bottom sheet that closes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'phone-only: from sm up Price is the popover above')
    await page.goto(CATEGORY_ROUTE, { waitUntil: 'domcontentloaded' })
    await facetBarMounted(page)

    const trigger = page.locator('[data-slot="drawer-trigger"]', { hasText: /price|giá/i }).first()
    await expect(trigger, 'the facet bar mounted but has no Price pill').toBeVisible()
    // The phone branch REPLACES the popover; it does not sit beside it.
    await expect(page.locator('[data-slot="popover-trigger"]', { hasText: /price|giá/i })).toHaveCount(0)
    await trigger.click()

    const sheet = page.locator(SHEET)
    await expect(sheet).toBeVisible()
    await expect(page.getByRole('dialog', { name: /^(Price range|Khoảng giá)$/ })).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(POPOVER)).toHaveCount(0)
    // Full width, on the bottom edge. The sheet slides up over 450ms — measure where it SETTLES.
    const vp = page.viewportSize()!
    await expect.poll(async () => { const b = await sheet.boundingBox(); return b && Math.round(b.y + b.height) }).toBe(vp.height)
    const box = (await sheet.boundingBox())!
    expect(box.x).toBe(0)
    expect(Math.round(box.width)).toBe(vp.width)

    // It closes through its own action — "Show {n} results", "≈{n}" when the count is approximate,
    // bare while the histogram loads — and leaves the pill collapsed.
    await sheet.getByRole('button', { name: /^(Show(?: ≈?[\d,.]+)? results?|Xem(?: ≈?[\d.,]+)? kết quả)$/ }).click()
    await expect(page.locator(SHEET)).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  // ⛔ THERE IS DELIBERATELY NO "wheel INSIDE the popup leaves it open" CASE HERE, AND THE REASON
  // IS WORTH KEEPING. The first version of this file asserted exactly that, and it was wrong twice
  // over. It failed on guest-mobile because Playwright's synthetic `mouse.wheel` inside a touch
  // context reports the full-viewport backdrop as its target rather than the element under the
  // cursor — a harness artifact for a gesture no phone can produce. And it was asserting the WRONG
  // RULE: a popover with nothing scrollable in it does not consume the gesture, the page scrolls
  // underneath (measured: 227px), and dismissing is then the correct outcome. The real invariant —
  // a popup that CAN scroll keeps its own gesture — is a pure DOM predicate and is unit-tested in
  // src/components/ui/use-dismiss-on-user-scroll.test.ts, where it can be stated exactly.
})

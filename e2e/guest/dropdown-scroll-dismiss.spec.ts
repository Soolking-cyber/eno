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

const CATEGORY_ROUTE = '/?category=vehicles'
const POPOVER = '[data-slot="popover-content"]'

test.describe('Guest · open popups dismiss on a user scroll', () => {
  test('the facet bar price popover closes when the page is wheeled', async ({ page }) => {
    await page.goto(CATEGORY_ROUTE)

    const trigger = page.locator('[data-slot="popover-trigger"]', { hasText: /price|giá/i }).first()
    await expect(trigger, 'the facet bar did not render — check the /?category= entry point').toBeVisible()
    await trigger.click()
    await expect(page.locator(POPOVER)).toBeVisible()

    // Wheel over the page, NOT over the popup: a gesture that starts inside a popup belongs to
    // that popup (a long list scrolling itself must never dismiss itself).
    await page.mouse.move(40, 600)
    await page.mouse.wheel(0, 450)

    await expect(page.locator(POPOVER)).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollY), 'the page should have actually moved').toBeGreaterThan(0)
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

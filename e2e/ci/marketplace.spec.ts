import { test, expect } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// THE FIXTURE-BACKED MARKETPLACE GATE (review Q01).
//
// ⚠️ THIS IS THE SUITE THAT MAY BLOCK A MERGE, WHICH IS WHY IT OWNS ITS OWN DATA.
// The `e2e/guest/**` specs read whatever the target deployment happens to hold, so
// they go red for reasons an author cannot fix — a listing sold, a hide-list change
// — and a gate that cries wolf teaches everyone to re-run until green. Every
// assertion here is against rows `scripts/ci-fixtures.ts` created moments earlier
// in a throwaway Postgres, so a failure means the CODE changed.
//
// ⛔ NEVER point this at production: the assertions below would then be claims about
// real inventory. The workflow builds its own server on :3100 and passes E2E_CI_BASE.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURES = ['Fixture laptop', 'Fixture phone', 'Fixture desk lamp', 'Fixture studio flat', 'Fixture city scooter', 'Fixture bicycle']

test.describe('marketplace, against known fixtures', () => {
  test('the home feed renders every fixture listing', async ({ page }) => {
    await page.goto('/')
    for (const title of FIXTURES) {
      await expect(page.getByText(title, { exact: false }).first(), `"${title}" should be in the feed`).toBeVisible()
    }
  })

  // ⛔ THE LICENSING CONTROL, ASSERTED IN A BROWSER. eno.vn is a licensed marketplace and may not
  // surface the visa/trip desk; `scopedListingWhere` excludes it, and a runtime bypass of exactly
  // that filter is what leaked 14 e-visa listings into ?q=visa on 2026-09-01. Unit tests cover the
  // predicate; only a rendered page covers the path from request to HTML.
  test('the desk listing never reaches the marketplace, by feed or by search', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Fixture e-visa')).toHaveCount(0)
    await page.goto('/?q=visa')
    await expect(page.getByText('Fixture e-visa')).toHaveCount(0)
  })

  // ⛔ THE ROUTES THEMSELVES, NOT ONLY THE ROW. A reviewer was right that asserting one listing
  // title is absent proves very little about a LEGAL boundary: the licensed marketplace must not
  // serve the visa or itinerary surfaces at all. They are `.svc.` files excluded from this
  // edition's `pageExtensions`, so on this build they do not exist — and "the build that ships is
  // the one that decides" is exactly what a browser can check and a unit test cannot.
  test('the licensed edition does not serve the visa or itinerary surfaces', async ({ page }) => {
    for (const path of ['/visa', '/itinerary']) {
      const res = await page.goto(path)
      expect(res?.status(), `${path} must not exist on the marketplace edition`).toBe(404)
    }
  })

  test('a category page shows its own fixtures and no others', async ({ page }) => {
    await page.goto('/c/vehicles')
    await expect(page.getByText('Fixture city scooter').first()).toBeVisible()
    await expect(page.getByText('Fixture bicycle').first()).toBeVisible()
    await expect(page.getByText('Fixture desk lamp')).toHaveCount(0)
  })

  test('search finds a fixture by title', async ({ page }) => {
    await page.goto('/?q=bicycle')
    await expect(page.getByText('Fixture bicycle').first()).toBeVisible()
  })

  // ⚠️ THE OWNER REPORTED THIS TWICE ("the text overlaps"), AND A UNIT TEST CANNOT SEE IT: the
  // price is an inline run, so its own scrollWidth/clientWidth are 0 — only its rect against the
  // CARD's rect shows the spill. Measured on prod before the fix: 8 of 8 service cards overflowed
  // by 24–77px at 320–430px wide. This asserts the geometry, at the width where it was worst.
  test('no price spills out of its card on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.waitForTimeout(500)
    // ⛔ A COUNT FIRST, OR THIS TEST PASSES ON AN EMPTY PAGE. "No price overflowed" is trivially
    // true when nothing rendered — and a stale server serving a build with no fixtures is exactly
    // the state that produced a green run during development.
    await expect(page.locator('[data-card-root]').first()).toBeVisible()
    expect(await page.locator('[data-card-root]').count()).toBeGreaterThanOrEqual(6)
    const spills = await page.evaluate(() => {
      const out: string[] = []
      for (const card of document.querySelectorAll('[data-card-root]')) {
        const cr = card.getBoundingClientRect()
        for (const el of card.querySelectorAll('span.tabular-nums, span.tabular-nums span')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0) continue
          if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) out.push(`${(el.textContent || '').trim()} +${Math.round(r.right - cr.right)}px`)
        }
      }
      return out
    })
    expect(spills, 'price runs must stay inside their card').toEqual([])
  })
})

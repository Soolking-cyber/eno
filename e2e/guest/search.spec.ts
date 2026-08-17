import { test, expect } from '../helpers'

// Guest search. The header search parses a free-text query and renders results on the same
// route with facet params (scouted: "iphone" → ?category=electronics&brand=apple&model=…,
// heading "Found N listings"). We assert that reliable end-to-end behaviour rather than the
// typeahead dropdown, which exposes no stable role/testid yet (a data-testid would make it
// robustly testable — deferred).
// ⚠️ NOT /Marketplace listings/ — that is an UNCONDITIONAL sr-only <h1>
// (listings-explorer.tsx:2011) that renders whether or not a single listing came back.
// Proven vacuous: with every /api/listings response stubbed empty, the old assertion still
// passed. Only the COUNT is evidence that a search actually resolved.
//
// ⛔ THIS USED TO MATCH /Found \d+ listing/ AS A HEADING, AND IT HAD BEEN FAILING ON PRODUCTION.
// Two things moved and neither was noticed, because the failure was hidden by a truncated log:
// the word "Found" was deliberately deleted (listings-explorer.tsx says it "says the same word
// twice" beside the sr-only "Marketplace listings" heading), and the count moved into
// <ResultLine>, where it is a `<p aria-live="polite">` rather than a heading. So the locator was
// wrong on BOTH the text and the role, and no amount of waiting was going to find it.
//
// ⚠️ THE INTENT IS UNCHANGED AND MUST STAY THAT WAY: assert the COUNT, because a results view
// that resolved to nothing still renders chrome. The count now reads "32 listings" / "1 listing"
// (resultCountLabel), so the pattern below is the same claim with the dead word removed.
const RESULTS_COUNT = /\d+\s+listing/i

test.describe('Guest · search', () => {
  test('a query resolves to a results view with facet params', async ({ page }) => {
    await page.goto('/')
    // Header search (the hero bar was removed 2026-08-03) — :visible picks the mobile-vs-desktop
    // twin that is actually rendered at this viewport; both are in the DOM.
    const box = page.locator('input[placeholder*="Find products"]:visible').first()
    await box.fill('iphone')
    await box.press('Enter')
    await expect(page).toHaveURL(/[?&](category|brand|model|q|search)=/i)
    await expect(page.getByText(RESULTS_COUNT).first()).toBeVisible()
    // And that the count is REAL — "0 listings" renders on a dead API too.
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
  })

  test('a second query also returns a results view', async ({ page }) => {
    await page.goto('/')
    // Header search (the hero bar was removed 2026-08-03) — :visible picks the mobile-vs-desktop
    // twin that is actually rendered at this viewport; both are in the DOM.
    const box = page.locator('input[placeholder*="Find products"]:visible').first()
    await box.fill('honda')
    await box.press('Enter')
    await expect(page.getByText(RESULTS_COUNT).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
  })
})

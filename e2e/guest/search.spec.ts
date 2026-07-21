import { test, expect } from '../helpers'

// Guest search. The header search parses a free-text query and renders results on the same
// route with facet params (scouted: "iphone" → ?category=electronics&brand=apple&model=…,
// heading "Found N listings"). We assert that reliable end-to-end behaviour rather than the
// typeahead dropdown, which exposes no stable role/testid yet (a data-testid would make it
// robustly testable — deferred).
// ⚠️ NOT /Marketplace listings/ — that is an UNCONDITIONAL sr-only <h1>
// (listings-explorer.tsx:2011) that renders whether or not a single listing came back.
// Proven vacuous: with every /api/listings response stubbed empty, the old assertion still
// passed. Only the COUNT heading is evidence that a search actually resolved.
const RESULTS_HEADING = /Found \d+ listing/i

test.describe('Guest · search', () => {
  test('a query resolves to a results view with facet params', async ({ page }) => {
    await page.goto('/')
    const box = page.getByPlaceholder(/Search motorbikes/i)
    await box.fill('iphone')
    await box.press('Enter')
    await expect(page).toHaveURL(/[?&](category|brand|model|q|search)=/i)
    await expect(page.getByRole('heading', { name: RESULTS_HEADING }).first()).toBeVisible()
    // And that the count is REAL — "Found 0 listings" renders on a dead API too.
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
  })

  test('a second query also returns a results view', async ({ page }) => {
    await page.goto('/')
    const box = page.getByPlaceholder(/Search motorbikes/i)
    await box.fill('honda')
    await box.press('Enter')
    await expect(page.getByRole('heading', { name: RESULTS_HEADING }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
  })
})

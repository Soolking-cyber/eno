import { test, expect } from '../helpers'

// Guest search. The header search parses a free-text query and renders results on the same
// route with facet params (scouted: "iphone" → ?category=electronics&brand=apple&model=…,
// heading "Found N listings"). We assert that reliable end-to-end behaviour rather than the
// typeahead dropdown, which exposes no stable role/testid yet (a data-testid would make it
// robustly testable — deferred).
const RESULTS_HEADING = /Found \d+ listing|Marketplace listings/i

test.describe('Guest · search', () => {
  test('a query resolves to a results view with facet params', async ({ page }) => {
    await page.goto('/')
    const box = page.getByPlaceholder(/Search motorbikes/i)
    await box.fill('iphone')
    await box.press('Enter')
    await expect(page).toHaveURL(/[?&](category|brand|model|q|search)=/i)
    await expect(page.getByRole('heading', { name: RESULTS_HEADING }).first()).toBeVisible()
  })

  test('a second query also returns a results view', async ({ page }) => {
    await page.goto('/')
    const box = page.getByPlaceholder(/Search motorbikes/i)
    await box.fill('honda')
    await box.press('Enter')
    await expect(page.getByRole('heading', { name: RESULTS_HEADING }).first()).toBeVisible()
  })
})

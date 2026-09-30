import { test, expect } from '../helpers'

// The explorer's sort strip (Liên quan / Mới nhất / Được quan tâm / Giá) was a row of plain
// <button>s until 2026-07-14. It LOOKED like tabs and reported nothing: no tablist, no
// aria-selected, and the keyboard could not traverse it. It is now ui/tabs (Base UI), and these
// tests exist so it cannot quietly regress to buttons — the pixels are identical either way, so
// nothing else in the suite would notice. Every assertion below is a property a <button> strip
// CANNOT satisfy.
//
// ⚠️ THE SURFACE MOVED ON 2026-09-05, AND AGAIN ON 2026-09-29 — THE TABLIST IS ON BOTH PAGES NOW.
// This file used to load /c/electronics. From 2026-09-05 that page was a PREVIEW (48 of thousands;
// review U01 found that sorting those 48 in memory reordered the same 48 ids while the heading
// announced the full count), so its strip became a row of LINKS into the explorer — and a sort LEFT
// the page, into a URL canonicalised to /. C1-DEADEND (2026-09-29) made every sort and Show-more on
// /c/<category> a scoped /api/listings query over the WHOLE category, in place, so the page holds a
// real tablist again and the links are gone. Both surfaces are asserted below: the category page's
// in-place tabs, and the explorer results view's.
// The strip only renders in RESULTS mode, not on the bare homepage — hence ?category=.
//
// ⚠️ Activation is MANUAL (Base UI's activateOnFocus defaults to false): arrows move focus,
// Enter commits. Asserting that an arrow key alone re-sorts would be asserting a bug — auto-
// activation would fire a product query on every keypress. Focus and selection are deliberately
// two different things here, and the test says so.
test.describe('Guest · sort tabs — a11y semantics', () => {
  // ⛔ A CATEGORY SORT IS A QUERY IN PLACE, NOT A WAY OUT (C1-DEADEND). If these become links again,
  // the reader is thrown into the explorer at `/?category=…` and loses the page; if the tabs sort the
  // rows already on screen instead of asking the server, "Price" reorders 48 of thousands and lies.
  // So: one tablist, exactly one price tab, no `?sort=` links anywhere, and choosing Price asks
  // /api/listings for this category's cheapest while the pathname stays put.
  test('a category page sorts the whole category in place', async ({ page }) => {
    await page.goto('/c/electronics')
    // The strip is server-rendered and inert until React hydrates — a tap before then is swallowed
    // (seller-listings.tsx `data-listings-ready`). On a Pixel 5 that window was long enough to lose it.
    await expect(page.locator('[data-listings-ready="true"]').first()).toBeAttached()
    const tablist = page.getByRole('tablist').first()
    await expect(tablist).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(1)
    await expect(tablist.getByRole('tab', { name: /price|giá/i })).toHaveCount(1)
    await expect(page.locator('a[href*="sort="]')).toHaveCount(0)

    const sorted = page.waitForRequest((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/listings' && u.searchParams.get('category') === 'electronics' && u.searchParams.get('sort') === 'price-low'
    })
    await tablist.getByRole('tab', { name: /price|giá/i }).click()
    await sorted
    await expect(tablist.getByRole('tab', { name: /price|giá/i })).toHaveAttribute('aria-selected', 'true')
    expect(new URL(page.url()).pathname).toBe('/c/electronics')
  })

  test('the sort strip is a real tablist, not a row of buttons', async ({ page }) => {
    // Phones sort through one pill in the single scrolling toolbar line (owner, 2026-09-30); the explorer's
    // tablist is desktop-only there — /c/* keeps its tabs on every width (the test above).
    test.skip(test.info().project.name.includes('mobile'), 'phones sort via the sort pill (next test)')
    await page.goto('/?category=electronics')

    const tablist = page.getByRole('tablist').first()
    await expect(tablist).toBeVisible()

    const tabs = tablist.getByRole('tab')
    await expect(tabs).toHaveCount(4)
    // Exactly one tab reports itself selected — a button strip reports none.
    await expect(tablist.getByRole('tab', { selected: true })).toHaveCount(1)
  })

  test('arrows move roving focus; Enter commits the sort', async ({ page }) => {
    // Phones sort through one pill in the single scrolling toolbar line (owner, 2026-09-30); the explorer's
    // tablist is desktop-only there — /c/* keeps its tabs on every width (the test above).
    test.skip(test.info().project.name.includes('mobile'), 'phones sort via the sort pill (next test)')
    await page.goto('/?category=electronics')

    const tablist = page.getByRole('tablist').first()
    const selected = tablist.getByRole('tab', { selected: true })
    const before = (await selected.textContent())?.trim()

    // Roving focus: the selected tab is the strip's single tab stop.
    await selected.focus()
    await page.keyboard.press('ArrowRight')

    // Focus MOVED to a different tab — a button strip's arrow key does nothing at all.
    // (The tab IS the focused element, so ask the document, not for a focused descendant.)
    const focusedText = await page.evaluate(() => {
      const el = document.activeElement
      return el?.getAttribute('role') === 'tab' ? el.textContent?.trim() : null
    })
    expect(focusedText).not.toBeNull()
    expect(focusedText).not.toBe(before)

    // …but the SELECTION has not moved: activation is manual, so no re-sort has fired yet.
    await expect(tablist.getByRole('tab', { selected: true })).toHaveText(before ?? '')

    // Enter commits, and only now does the sort actually change.
    await page.keyboard.press('Enter')
    await expect(tablist.getByRole('tab', { selected: true })).not.toHaveText(before ?? '')
  })

  test('on a phone the explorer sorts through one pill in the toolbar line', async ({ page }) => {
    test.skip(!test.info().project.name.includes('mobile'), 'phone layout only')
    await page.goto('/?category=electronics')
    const pill = page.getByRole('combobox', { name: /sort|sắp xếp/i }).first()
    await expect(pill).toBeVisible()
    const box = await pill.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    const sorted = page.waitForRequest((r) => new URL(r.url()).searchParams.get('sort') === 'price-low')
    await pill.click()
    await page.getByRole('option', { name: /low to high|thấp đến cao/i }).first().click()
    await sorted
    await expect(page).toHaveURL(/sort=price-low/)
  })
})

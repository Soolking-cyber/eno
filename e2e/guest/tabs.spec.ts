import { test, expect } from '../helpers'

// The explorer's sort strip (Liên quan / Mới nhất / Được quan tâm / Giá) was a row of plain
// <button>s until 2026-07-14. It LOOKED like tabs and reported nothing: no tablist, no
// aria-selected, and the keyboard could not traverse it. It is now ui/tabs (Base UI), and these
// tests exist so it cannot quietly regress to buttons — the pixels are identical either way, so
// nothing else in the suite would notice. Every assertion below is a property a <button> strip
// CANNOT satisfy.
//
// ⚠️ THE SURFACE MOVED ON 2026-09-05, AND THE TABLIST DID NOT DISAPPEAR — IT SPLIT IN TWO.
// This file used to load /c/electronics. That page is a PREVIEW: 48 of a category that can hold
// thousands, and review U01 found that sorting those 48 in memory reordered the same 48 ids while
// the heading announced the full count. So a preview's sort strip is now a row of LINKS into the
// explorer's full paginated query (`?category=…&sort=…`), and the in-page TABLIST lives where
// sorting is genuinely in-page — the explorer results view. Both are asserted below: the tabs
// where they belong, and the links where the tabs used to be.
// The strip only renders in RESULTS mode, not on the bare homepage — hence ?category=.
//
// ⚠️ Activation is MANUAL (Base UI's activateOnFocus defaults to false): arrows move focus,
// Enter commits. Asserting that an arrow key alone re-sorts would be asserting a bug — auto-
// activation would fire a product query on every keypress. Focus and selection are deliberately
// two different things here, and the test says so.
test.describe('Guest · sort tabs — a11y semantics', () => {
  // The other half of the split: a category PREVIEW offers the same four orders as real links, so
  // choosing one searches the whole category instead of reshuffling the visible window. If these
  // ever become buttons again, the page is back to sorting 48 rows and lying about it.
  test('a category preview offers its sorts as links into the full query', async ({ page }) => {
    await page.goto('/c/electronics')
    const nav = page.getByRole('navigation', { name: /sort|sắp xếp/i }).first()
    await expect(nav).toBeVisible()
    const links = nav.getByRole('link')
    expect(await links.count(), 'newest, most contacted, price up, price down').toBeGreaterThanOrEqual(4)
    await expect(links.first()).toHaveAttribute('href', /[?&]sort=/)
  })

  test('the sort strip is a real tablist, not a row of buttons', async ({ page }) => {
    await page.goto('/?category=electronics')

    const tablist = page.getByRole('tablist').first()
    await expect(tablist).toBeVisible()

    const tabs = tablist.getByRole('tab')
    await expect(tabs).toHaveCount(4)
    // Exactly one tab reports itself selected — a button strip reports none.
    await expect(tablist.getByRole('tab', { selected: true })).toHaveCount(1)
  })

  test('arrows move roving focus; Enter commits the sort', async ({ page }) => {
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
})

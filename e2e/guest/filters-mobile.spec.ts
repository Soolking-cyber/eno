import { test, expect, dismissOverlays } from '../helpers'

/**
 * PHONE FILTERS ARE BOTTOM SHEETS (E-FILTER-SHEET, 2026-09-29) — the smoke test for the three panels
 * the explorer's facet row opens below `sm`: Price, Filter and Area. Each is a ui/drawer pinned to the
 * bottom edge, full width, over the floating tab bar, and ends on its action row. Desktop keeps the
 * anchored popovers (area-filter.spec.ts and the unit suites cover those).
 * ⚠️ READ-ONLY: every non-GET request is aborted, so nothing here can write (a filter tap only ever
 * reads /api/listings, but analytics beacons are POSTs).
 */
test.describe('Guest · phone filter sheets', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'phone-only: from sm the panels are popovers')
    await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
    await page.goto('/?category=rentals&subcategory=apartment-rental')
    await dismissOverlays(page)
    await expect(page.locator('#explorer-toolbar')).toBeVisible()
  })

  test('Price opens a full-width sheet over the tab bar, with a grouped count on its action', async ({ page }) => {
    await page.locator('#explorer-toolbar').getByRole('button', { name: /^(Price|Giá)/ }).first().click()
    const sheet = page.locator('[data-slot=drawer-popup]')
    await expect(sheet).toBeVisible()
    const vp = page.viewportSize()!
    // The sheet slides up over 450ms — measure where it SETTLES, not a frame of the slide.
    await expect.poll(async () => { const b = await sheet.boundingBox(); return b && Math.round(b.y + b.height) }).toBe(vp.height)
    const box = await sheet.boundingBox()
    expect(box!.x).toBe(0)
    expect(Math.round(box!.width)).toBe(vp.width)
    await expect(sheet.getByRole('button', { name: /^(Show [\d,]+ results?|Xem [\d.]+ kết quả|Show results|Xem kết quả)$/ })).toBeVisible({ timeout: 15000 })
    // A typed maximum is grouped and fits its field.
    const max = sheet.locator('input[inputmode=numeric]').nth(1)
    await max.fill('1450000000')
    await expect(max).toHaveValue(/^1[,.]450[,.]000[,.]000$/)
    expect(await max.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // Nothing behind the sheet takes the tap: the tab bar's centre lands on the sheet or its scrim.
    const onSheet = await page.evaluate(() => {
      const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect()
      if (!nav) return true
      const hit = document.elementFromPoint(nav.left + nav.width / 2, nav.top + nav.height / 2)
      return !!hit?.closest('[data-slot=drawer-popup],[data-slot=drawer-overlay],[data-slot=drawer-viewport]')
    })
    expect(onSheet).toBe(true)
  })

  test('the Filter sheet names the size facet "Size" with its unit, and the Area sheet ends on Clear / Apply', async ({ page }) => {
    const filter = page.locator('#explorer-toolbar').getByRole('button', { name: /^(Filter|Bộ lọc)/ }).first()
    if (await filter.count()) {
      await filter.click()
      const sheet = page.locator('[data-slot=drawer-popup]')
      await expect(sheet).toBeVisible()
      if (await sheet.getByText(/^(Size|Diện tích)$/i).count()) {
        await expect(sheet.getByPlaceholder(/^(Min|Tối thiểu) m²$/)).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
    }
    await page.locator('#explorer-toolbar').getByRole('button', { name: /^(Area|Khu vực)/ }).first().click()
    // The sheet is named by its title, "Area" (the desktop popover's aria-label is "Choose area").
    const area = page.getByRole('dialog', { name: /^(Area|Khu vực)$/ })
    await expect(area).toBeVisible()
    await expect(area.getByRole('button', { name: /^(Clear|Xóa)$/ })).toBeVisible()
    await expect(area.getByRole('button', { name: /Apply|Áp dụng/ })).toBeVisible()
  })

  test('the toolbar carries no reset of its own — the result line\'s "Clear all" is the one', async ({ page }) => {
    await expect(page.locator('#explorer-toolbar').getByRole('button', { name: /^(Clear|Xóa lọc)$/ })).toHaveCount(0)
  })
})

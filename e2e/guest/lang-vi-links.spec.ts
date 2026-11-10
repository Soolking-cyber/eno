import type { Page } from '@playwright/test'
import { test, expect, expectedEdition, viPilotOn } from '../helpers'

// ⛔ A VIETNAMESE READER STAYS IN VIETNAMESE WHEN THEY SEARCH OR FILTER (A1-LANG, field-01).
//
// On eno.vn the plain `/` is English for everyone and `/vi` is its Vietnamese twin (the /vi pilot,
// decision V-a). The header search, 'Bộ lọc' and the brand chip used to lead to the plain `/?…` from every
// Vietnamese /c page and PDP, so the reader landed on an English page with the "Trang này có bản tiếng
// Việt" banner over the grid. Every such link now goes through `localizedHref` (src/lib/lang-pinned.ts);
// this spec walks the three routes production showed broken. The literal-link ratchet is
// src/lib/lang-links.ratchet.test.ts. eno.forum has no `/vi` twin, so the whole spec is eno.vn's.

async function seedVi(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error('no baseURL')
  await page.context().addCookies([{ name: 'lang', value: 'vi', url: baseURL }])
  await page.addInitScript(() => { try { localStorage.setItem('lang', 'vi') } catch { /* */ } })
}

/** Search from the header the way a reader does: type, Enter. Works before hydration too (a GET form). */
async function headerSearch(page: Page, q: string) {
  const box = page.locator('header form[role="search"] input[name="q"]').first()
  await box.waitFor({ state: 'visible', timeout: 15_000 })
  await box.fill(q)
  await box.press('Enter')
}

async function expectVietnameseHome(page: Page) {
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/vi')
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
}

test.describe('Guest · lang=vi — searching and filtering stay Vietnamese', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    test.skip(!viPilotOn(edition), 'eno.forum has no /vi twin: its / follows the choice')
    await seedVi(page, baseURL)
  })

  test('the header search on /c/electronics lands on /vi, keeping the category', async ({ page }) => {
    await page.goto('/c/electronics', { waitUntil: 'load' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    await headerSearch(page, 'iphone')
    await expectVietnameseHome(page)
    const params = new URL(page.url()).searchParams
    expect(params.get('q')).toBe('iphone')
    expect(params.get('category')).toBe('electronics')
  })

  // ⚠️ ON A PHONE A LISTING WITH PHOTOS HAS NO SITE HEADER (2026-11-10, owner: item 3 of the decision scorecard): the page
  // opens on the photo and Back sits over it. So there the way out of the page is Back, and THAT is what must keep the
  // reader in Vietnamese; the header search is checked wherever the header is (every wider screen, and a phone's listing
  // without photos). Decided by what the page shows, not by the project's name: if the header went missing anywhere else,
  // Back would not be there either and this fails on its `toBeVisible`.
  test('leaving a PDP from its top bar keeps the reader in Vietnamese: the header search, or Back where a phone shows no header', async ({ page }) => {
    await page.goto('/vi', { waitUntil: 'load' })
    const card = page.locator('.feed-grid a[data-card-link]').first()
    await card.waitFor({ timeout: 20_000 })
    await page.goto(new URL((await card.getAttribute('href'))!, page.url()).pathname, { waitUntil: 'load' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    const header = page.locator('#app-header')
    if (await header.isVisible()) {
      await headerSearch(page, 'xe máy')
      await expectVietnameseHome(page)
      return
    }
    // No header is right in exactly one place: below 768px, on a listing that opens on its photo. Anywhere else a missing
    // header is a failure, whatever else is on the page (commit review).
    expect(page.viewportSize()!.width, 'only a phone may be without the site header here').toBeLessThan(768)
    await expect(page.locator('main [data-photo-first]')).toHaveCount(1)
    const back = page.locator('main [data-photo-back]')
    await expect(back).toBeVisible()
    // A real same-site link, named in Vietnamese, even before it is tapped…
    await expect(back).toHaveAttribute('href', /^\/(?!\/)/)
    await expect(back).toHaveAttribute('aria-label', 'Quay lại')
    // …and the tap returns to the Vietnamese page the reader came from.
    await back.click()
    await expectVietnameseHome(page)
  })

  test("'Bộ lọc' on /c/rentals opens the Vietnamese explorer", async ({ page }) => {
    await page.goto('/c/rentals', { waitUntil: 'load' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    const filters = page.getByRole('link', { name: 'Bộ lọc', exact: true })
    test.skip((await filters.count()) === 0, 'no live rentals in this database: the sort strip is not rendered')
    await expect(filters.first()).toHaveAttribute('href', /^\/vi\?/)
    await filters.first().click()
    await expectVietnameseHome(page)
    expect(new URL(page.url()).searchParams.get('category')).toBe('rentals')
  })
})

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

  test('the header search on a PDP lands on /vi', async ({ page }) => {
    await page.goto('/vi', { waitUntil: 'load' })
    const card = page.locator('a[data-card-link]').first()
    await card.waitFor({ timeout: 20_000 })
    await page.goto(new URL((await card.getAttribute('href'))!, page.url()).pathname, { waitUntil: 'load' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    await headerSearch(page, 'xe máy')
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

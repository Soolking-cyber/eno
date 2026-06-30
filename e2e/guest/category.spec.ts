import { test, expect } from '../helpers'

// Guest category page. Cards are clickable `div[role=button]` (router.push), NOT anchors —
// so we open one by clicking the card itself (identified by its price text) and assert the
// client-side navigation to a listing detail.
test.describe('Guest · category (/c/electronics)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/c/electronics') })

  test('renders the category with listings', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /Electronics in Vietnam/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
  })

  test('exposes district facets', async ({ page }) => {
    await expect(page.locator('a[href^="/c/electronics/district-"]').first()).toBeVisible()
  })

  test('clicking a card opens the listing detail (client routing)', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add favorite' }).first()).toBeVisible()
    // The card container is the role=button carrying the price text (the heart/map/carousel
    // buttons have aria-labels and no price), so this resolves to the first listing card.
    const card = page.getByRole('button').filter({ hasText: /VND|₫/ }).first()
    await card.click()
    await expect(page).toHaveURL(/\/listings\//)
  })
})

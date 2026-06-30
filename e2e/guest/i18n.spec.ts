import { test, expect } from '../helpers'

// Language pipeline for guests. There's no header language selector when logged out — the UI
// language is driven by localStorage 'lang' (mirrored to a cookie). We seed it BEFORE load and
// assert the category labels localize. (addInitScript runs before the app's scripts.)
test.describe('Guest · language pipeline', () => {
  test('renders Vietnamese when lang=vi', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'vi') } catch { /* */ } document.cookie = 'lang=vi; path=/' })
    await page.goto('/')
    // Scope to a VISIBLE button (the category grid renders a hidden mobile-nav duplicate too).
    await expect(page.locator('button:visible', { hasText: 'Điện tử' }).first()).toBeVisible() // "Electronics" in VI
    await expect(page.locator('button:visible', { hasText: /^Electronics$/ })).toHaveCount(0)
  })

  test('renders English when lang=en', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch { /* */ } document.cookie = 'lang=en; path=/' })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Electronics/ })).toBeVisible()
  })
})

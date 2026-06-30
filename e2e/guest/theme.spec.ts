import { test, expect } from '../helpers'

// Dark mode. The app's pre-hydration inline script sets <html class="dark"> from the saved
// 'eno-theme' choice, falling back to the OS preference when unset — so both the System
// default and a persisted choice apply on first paint (no flash of the wrong theme).

test.describe('Guest · dark mode — System default', () => {
  test.use({ colorScheme: 'dark' })
  test('follows the OS dark preference when no choice is saved', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})

test.describe('Guest · dark mode — persisted choice', () => {
  test('a saved dark choice applies on load (no FOUC)', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('eno-theme', 'dark') } catch { /* */ } })
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})

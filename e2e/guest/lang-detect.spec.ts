import { test, expect } from '../helpers'

// Browser-language auto-detect (no ?lang= param, no saved preference): the app renders in the
// device/browser language on first visit. The definitive signals are the <html lang> attribute and
// the `lang` cookie the detector writes — asserted here (visible copy differs desktop vs mobile).
// The SAME detection runs on web desktop, web mobile, and the iOS/Android WebViews (with a
// @capacitor/device confirm on native). A saved preference always wins; this covers first-visit only.

const langCookie = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.cookie.match(/(?:^|;\s*)lang=(\w[\w-]*)/)?.[1] ?? null)

test.describe('Guest · auto-detect — Vietnamese', () => {
  test.use({ locale: 'vi-VN' })
  test('vi-VN browser → <html lang>=vi + lang=vi cookie', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('vi')
    await expect.poll(() => langCookie(page)).toBe('vi')
  })
})

test.describe('Guest · auto-detect — English', () => {
  test.use({ locale: 'en-US' })
  test('en-US browser → <html lang>=en + lang=en cookie', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en')
    await expect.poll(() => langCookie(page)).toBe('en')
  })
})

import { test, expect, expectedEdition, viPilotOn, ADAPTIVE_PAGE, serverHtmlLang } from '../helpers'

// Browser-language auto-detect (no ?lang= param, no saved preference): the app renders in the
// device/browser language on first visit. The definitive signals are the <html lang> attribute and
// the `lang` cookie the detector writes — asserted here (visible copy differs desktop vs mobile).
// The SAME detection runs on web desktop, web mobile, and the iOS/Android WebViews (with a
// @capacitor/device confirm on native). A saved preference always wins; this covers first-visit only.
//
// ⛔ DETECTION IS ASSERTED ON AN ADAPTIVE PAGE, NOT ON `/` (e2e/helpers.ts ADAPTIVE_PAGE). Since the /vi
// pilot (2026-10-02) eno.vn's plain `/` is English for everyone and `/vi` is the Vietnamese twin, so a
// vi-VN browser on `/` correctly gets English there — this spec expecting `vi` on `/` failed on
// production by design. What the pilot itself promises is asserted in its own block below.
// ⚠️ That a pinned page records NO detection (no cookie write for a browser it disagrees with) is an
// absence after hydration and is unit-tested, not asserted here: src/context/language-context.vi-pilot.test.tsx.

// ⚠️ `load`, NOT `networkidle`: the detector's cookie is written by a mount effect after hydration, and
// expect.poll waits for it. networkidle measured flaky against production under load (a 20s goto timeout
// on /privacy and / while the page itself was fine), and it was only ever a proxy for "hydrated".
// The cookie is written after HYDRATION, which under a loaded machine took over the default 10 s expect
// timeout while the page itself was fine (measured: 10 parallel browsers at load ~100). 15 s, inside the
// 30 s test budget.
const HYDRATED = { timeout: 15_000 }
const langCookie = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.cookie.match(/(?:^|;\s*)lang=(\w[\w-]*)/)?.[1] ?? null)

test.describe('Guest · auto-detect — Vietnamese', () => {
  test.use({ locale: 'vi-VN' })
  test('vi-VN browser on an adaptive page → <html lang>=vi + lang=vi cookie', async ({ page }) => {
    await page.goto(ADAPTIVE_PAGE, { waitUntil: 'load' })
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('vi')
    await expect.poll(() => langCookie(page), HYDRATED).toBe('vi')
  })
})

test.describe('Guest · auto-detect — English', () => {
  test.use({ locale: 'en-US' })
  test('en-US browser on an adaptive page → <html lang>=en + lang=en cookie', async ({ page }) => {
    await page.goto(ADAPTIVE_PAGE, { waitUntil: 'load' })
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en')
    await expect.poll(() => langCookie(page), HYDRATED).toBe('en')
  })

  test('en-US browser on / → <html lang>=en + lang=en cookie (every edition)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' })
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en')
    await expect.poll(() => langCookie(page), HYDRATED).toBe('en')
  })

  test('en-US browser on /vi → still Vietnamese on the pilot (the twin does not negotiate)', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    test.skip(!viPilotOn(edition), 'eno.forum has no /vi twin (asserted below)')
    const res = await page.goto('/vi', { waitUntil: 'load' })
    expect(serverHtmlLang(await res!.text())).toBe('vi')
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('vi')
  })
})

test.describe('Guest · the /vi pilot — a vi-VN browser', () => {
  test.use({ locale: 'vi-VN' })
  test('eno.vn: / stays English and /vi is Vietnamese; eno.forum: / follows the browser and /vi does not exist', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    // ⚠️ REDIRECTS ARE FOLLOWED (a www↔apex canonicalisation is legal), BUT THE PATH MUST SURVIVE: the pilot
    // has no language redirect (decision V-a), so landing anywhere but /vi is itself the regression.
    const vi = await page.request.get(`/vi?e2e=${Date.now()}`, { failOnStatusCode: false })
    expect(new URL(vi.url()).pathname, '/vi must not redirect to another path').toBe('/vi')
    if (viPilotOn(edition)) {
      expect(vi.status(), 'eno.vn must serve its /vi twin').toBe(200)
      const home = await page.goto('/', { waitUntil: 'load' })
      expect(serverHtmlLang(await home!.text())).toBe('en')
      await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en')
      await page.goto('/vi', { waitUntil: 'load' })
      await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('vi')
      await expect.poll(() => langCookie(page), HYDRATED).toBe('vi')
    } else {
      expect(vi.status(), 'eno.forum has no /vi pilot').toBe(404)
      await page.goto('/', { waitUntil: 'load' })
      await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('vi')
    }
  })
})

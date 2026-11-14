import type { Page } from '@playwright/test'
import { test, expect, dismissOverlays } from '../helpers'

/**
 * ⛔ THE APP CHROME OF THE 2026-11-14 REDESIGN (owner-approved, cook r05: "after this cook round build all best options
 * and deploy") — the geometry no unit test can see, in English and Vietnamese:
 *   · the tab bar is docked: full width, its bottom on the screen's, 56px + the inset; it retracts on scroll down and
 *     returns on scroll up;
 *   · the header: a 44px round pill and a 36px mark on a phone; a 40px pill and a 40px mark from sm, the fused window
 *     when open;
 *   · the page end: 24px from the last thing in <main> to the footer's hairline on a phone.
 * ⚠️ READ-ONLY: every non-GET request is aborted (analytics beacons are POSTs).
 */

const FOOTER_PAGES = ['/', '/c/rentals', '/brands', '/help', '/schools', '/developers']

async function open(page: Page, path: string, lang: 'en' | 'vi', baseURL: string | undefined) {
  await page.context().addCookies([{ name: 'lang', value: lang, url: baseURL ?? 'http://localhost:3000' }])
  // The browser's own language agrees with the cookie, so the app has no reason to reconcile it with one more navigation.
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang === 'vi' ? 'vi-VN,vi;q=0.9' : 'en-US,en;q=0.9' })
  await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
  await page.goto(path)
  // A Vietnamese visit can settle with one more navigation (seen: "execution context was destroyed" in vi only): wait for
  // the network to go quiet before measuring, bounded so a polling page cannot hang the test.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await dismissOverlays(page)
  await page.evaluate(() => document.fonts.ready)
  // The fit runs in a layout effect and again on a frame after fonts and resizes: let two frames pass.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

for (const lang of ['en', 'vi'] as const) {
  test.describe(`Guest · phone chrome (${lang})`, () => {
    test.beforeEach(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'guest-mobile', 'phone chrome')
    })

    test('the tab bar is docked: full width, on the bottom edge, 56px + inset; it retracts and returns', async ({ page, baseURL }) => {
      await open(page, '/', lang, baseURL)
      const vp = page.viewportSize()!
      const nav = page.locator('nav.mobile-nav')
      const box = (await nav.boundingBox())!
      expect(Math.round(box.x)).toBe(0)
      expect(Math.round(box.width)).toBe(vp.width)
      expect(Math.round(box.y + box.height)).toBe(vp.height)
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(56)
      // A real page scroll, not mouse.wheel: in a touch context Playwright's synthetic wheel does not scroll the page
      // (see dropdown-scroll-dismiss.spec.ts), and the bar follows the scroll position.
      // useHideOnScroll ANCHORS on the first scroll frame and decides nothing there, so scroll in two steps a frame apart.
      await page.evaluate(() => window.scrollBy(0, 200))
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await page.evaluate(() => window.scrollBy(0, 700))
      await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
      // Back near the top (y < revealOffset) always brings the bar back.
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    })

    test('the header: a 44px round pill and a 36px mark', async ({ page, baseURL }) => {
      await open(page, '/', lang, baseURL)
      const pill = page.locator('#app-header form[role="search"] div.relative.z-50')
      const p = (await pill.boundingBox())!
      expect(Math.round(p.height)).toBe(44)
      expect(await pill.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(22)
      const logo = (await page.locator('#app-header [data-header-logo] img').boundingBox())!
      expect(Math.round(logo.width)).toBe(36)
    })

    for (const path of FOOTER_PAGES) {
      test(`${path}: 24px from the end of <main> to the footer's hairline`, async ({ page, baseURL }) => {
        await open(page, path, lang, baseURL)
        const gap = await page.evaluate(() => {
          const main = document.getElementById('main')
          const footer = document.getElementById('app-footer')
          if (!main || !footer) return null
          return Math.round(footer.getBoundingClientRect().top - (main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom)))
        })
        expect(gap).not.toBeNull()
        expect(Math.abs((gap ?? 0) - 24)).toBeLessThanOrEqual(2)
      })
    }
  })
}

test.describe('Guest · desktop header keeps its 40px tint pill', () => {
  test('a 40px pill and a 40px mark from sm; the open window is fused (flat bottom corners)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-desktop', 'desktop header')
    await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
    await page.goto('/')
    await dismissOverlays(page)
    const pill = page.locator('#app-header form[role="search"] div.relative.z-50')
    expect(Math.round((await pill.boundingBox())!.height)).toBe(40)
    expect(Math.round((await page.locator('#app-header [data-header-logo] img').boundingBox())!.width)).toBe(40)
    await page.locator('#app-header input[name="q"]').focus()
    await expect.poll(() => pill.evaluate((el) => parseFloat(getComputedStyle(el).borderBottomLeftRadius))).toBe(0)
  })
})

import { test, expect, dismissOverlays } from '../helpers'

/**
 * ⛔ ONE BOTTOM BAR AT A TIME ON A PINNED LISTING PAGE, AS IN THE iOS APP (owner, 2026-11-15: "shows either one … make it like
 * in ios for mobile web"): scrolled down, the chat tier alone; scrolled back up, the tab bar alone; no fade over the tier.
 * Phone only. READ-ONLY.
 */
test.describe('Guest · pinned listing page: one bottom bar at a time', () => {
  test('down → the tier alone; up → the tab bar alone, the tier out of view', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1000) >= 768, 'phone only')
    await page.goto('/?category=electronics')
    await dismissOverlays(page)
    const href = await page.locator('main a[href^="/listings/"]').first().getAttribute('href')
    test.skip(!href, 'no electronics listing')
    await page.goto(href!)
    await dismissOverlays(page)
    test.skip(!(await page.locator('#contact[data-pin-action]').count()), 'this listing does not pin its action')
    await page.waitForTimeout(300)
    test.skip(await page.locator('.mobile-nav[data-short-page]').count() > 0, 'a page too short to scroll keeps both bars')
    const vh = page.viewportSize()!.height
    const state = () => page.evaluate((vh) => {
      const tier = document.querySelector('#contact[data-pin-action]')!.getBoundingClientRect()
      const nav = document.querySelector('.mobile-nav')!
      const r = nav.getBoundingClientRect()
      const before = getComputedStyle(document.querySelector('#contact[data-pin-action]')!, '::before').content
      return { tierShown: tier.top < vh - 4, navShown: r.top < vh - 4 && getComputedStyle(nav).opacity !== '0', fade: before !== 'none' && before !== 'normal' && before !== '' }
    }, vh)
    // Real page scrolls in steps (a synthetic wheel does not scroll a touch page — chrome-phone.spec.ts).
    const scroll = async (dy: number) => { for (let i = 0; i < 4; i++) { await page.evaluate((d) => window.scrollBy(0, d), dy / 4); await page.waitForTimeout(80) } }
    await scroll(1200)
    await expect.poll(state).toEqual({ tierShown: true, navShown: false, fade: false })
    await scroll(-300)
    await expect.poll(state).toEqual({ tierShown: false, navShown: true, fade: false })
    await scroll(600)
    await expect.poll(state).toEqual({ tierShown: true, navShown: false, fade: false })
  })
})

import type { Page } from '@playwright/test'
import { test, expect } from '../helpers'

/**
 * ⛔ RENTAL RESULTS ON A PHONE: ONE COLUMN OF LARGE SQUARE CARDS (owner-approved 2026-11-14, cook r06 rentals-a — listing-grid.ts
 * LISTING_GRID_WIDE, listing-card.tsx `wide`). /c/rentals and the rentals feed (/?category=rentals), below sm:
 *   · each card is the content width with a SQUARE photo — bigger than the two-up card, never smaller (owner, 2026-11-14);
 *   · the text block: the price line with ONE trust slot at its end (the labelled check chip, or "Official partner" in words),
 *     then the title and the info line; no price line ever overflows its card, in English or Vietnamese;
 *   · /c/rentals' heading is the display line with its count after it, and its one control row reaches the screen edges;
 *   · the page never scrolls sideways.
 * From sm the grid is the 3/4-column grid it was (the desktop half below). Skips on an empty catalogue only.
 */

test.describe('Guest · rental results on a phone are one column of large square cards', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'guest-mobile', 'phone-only: from sm the grid is unchanged (desktop test below)')
  })

  async function cardsOf(page: Page) {
    return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main [data-card-root]')].slice(0, 6).map((root) => {
      const photo = root.querySelector<HTMLElement>('[data-rail-media]')!.getBoundingClientRect()
      const body = root.lastElementChild as HTMLElement
      const priceRow = body.firstElementChild as HTMLElement
      const slot = body.querySelector<HTMLElement>('[data-trust-slot]')
      return {
        x: photo.left, w: photo.width, h: photo.height,
        priceOverflows: priceRow.scrollWidth > priceRow.clientWidth + 1,
        slot: slot ? { visible: slot.offsetParent !== null, kids: slot.children.length } : null,
        // One visible check toggle per card at most (the photo's copy is display:none below sm).
        toggles: [...root.querySelectorAll<HTMLElement>('[data-rental-check-toggle]')].filter((t) => t.offsetParent !== null).length,
      }
    }))
  }

  for (const [name, path] of [['/c/rentals', '/c/rentals'], ['the rentals feed', '/?category=rentals']] as const) {
    test(`${name}: square cards the content width, one trust slot, no price overflow, no sideways scroll`, async ({ page }) => {
      await page.goto(path)
      await page.locator('main [data-card-root]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const cards = await cardsOf(page)
      if (cards.length < 2) test.skip(true, 'fewer than two live rentals on this build')
      const vw = page.viewportSize()!.width
      for (const c of cards) {
        expect(Math.abs(c.x - 12), 'the photo sits on the 12px gutter').toBeLessThanOrEqual(1)
        expect(Math.abs(c.w - (vw - 24)), 'the photo is the content width').toBeLessThanOrEqual(1)
        expect(Math.abs(c.h - c.w), 'the photo stays square').toBeLessThanOrEqual(1)
        expect(c.priceOverflows, 'a price line overflows its card').toBe(false)
        expect(c.slot?.visible, 'the trust slot is on screen').toBe(true)
        expect(c.slot!.kids).toBeLessThanOrEqual(1)
        expect(c.toggles).toBeLessThanOrEqual(1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw)
    })
  }

  test('/c/rentals: the display heading with its count after it; the one row bleeds to the screen edges', async ({ page }) => {
    await page.goto('/c/rentals')
    const count = page.locator('[data-heading-count]')
    if ((await count.count()) === 0) test.skip(true, 'no sort strip: 0–1 rentals live')
    const geo = await count.evaluate((el) => {
      const heading = el.previousElementSibling as HTMLElement
      const tabs = document.querySelector<HTMLElement>('[data-pinned-strip] [data-slot="tabs"]')!.getBoundingClientRect()
      return { size: parseFloat(getComputedStyle(heading).fontSize), weight: getComputedStyle(heading).fontWeight, tabsLeft: tabs.left, tabsRight: tabs.right, w: innerWidth }
    })
    expect(geo.size).toBe(28)
    expect(Number(geo.weight)).toBeGreaterThanOrEqual(700)
    expect(geo.tabsLeft).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geo.tabsRight - geo.w)).toBeLessThanOrEqual(0.5)
  })

  test('Vietnamese: no price line overflows, the page never scrolls sideways', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'lang', value: 'vi', url: baseURL }])
    await page.goto('/c/rentals')
    const cards = await cardsOf(page)
    if (cards.length < 2) test.skip(true, 'fewer than two live rentals on this build')
    for (const c of cards) expect(c.priceOverflows).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  })
})

test('desktop: /c/rentals keeps its multi-column grid and the photo chip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'guest-desktop', 'desktop-only')
  await page.goto('/c/rentals')
  const tops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main [data-card-root]')].slice(0, 4).map((r) => Math.round(r.getBoundingClientRect().top)))
  if (tops.length < 4) test.skip(true, 'fewer than four live rentals on this build')
  // The first four cards share one row from lg.
  expect(new Set(tops).size).toBe(1)
  expect(await page.locator('main [data-trust-slot]').filter({ visible: true }).count()).toBe(0)
})

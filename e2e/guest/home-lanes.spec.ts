import { test, expect } from '../helpers'

/**
 * ⛔ THE HOME PAGE'S PHONE LANES (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — listings-explorer.tsx, the
 * `data-home-lanes` block). On a phone the undirected home reads category tiles → lanes → toolbar → Recommended → grid; a
 * lane is a 22/28 heading over a rail of same-size 220px square cards, 12 apart, the first on the 12px text edge and the
 * second peeking. A directed cold link never lays the lanes out (the pre-paint mark, explorer-url.ts LANES_OFF_ATTR), and a
 * sort keeps them. From `sm` the block is hidden and the shelves sit under the feed as before. GET only.
 * Branches on the project's viewport: guest-mobile (Pixel 5, 393 px) and guest-desktop (1280 px).
 */
const phone = (w: number | undefined) => (w ?? 1280) < 640

/** Records, from before the first paint, whether the lanes block was EVER laid out, and every layout shift. */
const watch = () => {
  const w = window as unknown as { __lanesEver: boolean; __cls: number }
  w.__lanesEver = false
  w.__cls = 0
  type Shift = PerformanceEntry & { hadRecentInput?: boolean; value?: number }
  new PerformanceObserver((l) => { for (const e of l.getEntries() as Shift[]) if (!e.hadRecentInput) w.__cls += e.value ?? 0 }).observe({ type: 'layout-shift', buffered: true })
  const tick = () => {
    const el = document.querySelector('[data-home-lanes]')
    if (el && el.getClientRects().length > 0) w.__lanesEver = true
    if (performance.now() < 10_000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

test.describe('Guest · home lanes', () => {
  test('a phone opens on the lanes, above the toolbar and the feed; desktop keeps its shelves under the feed', async ({ page }) => {
    await page.goto('/')
    const lanes = page.locator('[data-home-lanes]')
    if (!phone(page.viewportSize()?.width)) {
      await expect(lanes).toBeHidden()
      return
    }
    await expect(lanes).toBeVisible()
    const geo = await page.evaluate(() => {
      const block = document.querySelector('[data-home-lanes]')!
      const toolbar = document.getElementById('explorer-toolbar')!
      const grid = document.querySelector('#listings .feed-grid')!
      const first = block.querySelector('section')!
      const cards = [...first.querySelectorAll('[data-shelf-items] > *, .overflow-x-auto > *')].slice(0, 2).map((c) => c.getBoundingClientRect())
      const photo = first.querySelector('[data-rail-media]')!.getBoundingClientRect()
      const h2 = getComputedStyle(first.querySelector('h2')!)
      return {
        aboveToolbar: block.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().top,
        aboveGrid: block.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top,
        card0: { left: cards[0].left, width: cards[0].width },
        step: cards[1].left - cards[0].left,
        secondPeeks: cards[1].left < innerWidth && cards[1].right > innerWidth,
        square: Math.abs(photo.width - photo.height) <= 1,
        heading: [h2.fontSize, h2.lineHeight],
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      }
    })
    expect(geo.aboveToolbar).toBe(true)
    expect(geo.aboveGrid).toBe(true)
    expect(geo.card0.width).toBeCloseTo(220, 0)
    expect(geo.card0.left).toBeCloseTo(12, 0)
    expect(geo.step).toBeCloseTo(232, 0)
    expect(geo.secondPeeks).toBe(true)
    expect(geo.square).toBe(true)
    expect(geo.heading).toEqual(['22px', '28px'])
    expect(geo.overflow).toBe(false)
  })

  test('a directed cold link never lays the lanes out; a sort keeps them', async ({ page }) => {
    test.skip(!phone(page.viewportSize()?.width), 'phone only — the lanes are hidden from sm')
    await page.addInitScript(watch)
    await page.goto('/?q=iphone')
    await expect(page.locator('#listings .feed-grid [data-feed-card]').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => (window as unknown as { __lanesEver: boolean }).__lanesEver), 'never laid out, not even for a frame').toBe(false)
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-home-lanes-off')), 'the mark goes once the lanes left the tree').toBe(false)
    await page.goto('/?sort=recent')
    await expect(page.locator('[data-home-lanes]')).toBeVisible()
  })

  test('no layout shift on load and the first scroll', async ({ page }) => {
    test.skip(!phone(page.viewportSize()?.width), 'phone only')
    await page.addInitScript(watch)
    await page.goto('/')
    await page.waitForTimeout(3000)
    // A scroll by script (a mobile-emulated page takes no wheel), three steps of a screen: the gated lanes draw on the way.
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 700)); await page.waitForTimeout(500) }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
    expect(cls).toBeLessThan(0.01)
  })
})

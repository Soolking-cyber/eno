import { test, expect } from '../helpers'

/**
 * ⛔ THE HOME PAGE'S PHONE LANES (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — listings-explorer.tsx, the
 * `data-home-lanes` block). On a phone the undirected home reads category tiles → lanes → toolbar → Recommended → grid; a
 * lane is a 22/28 heading over a rail of same-size 220px square cards, 12 apart, the first on the 12px text edge and the
 * second peeking. A directed cold link never lays the lanes out (the pre-paint mark, explorer-url.ts LANES_OFF_ATTR), and a
 * sort keeps them. From `sm` the block is hidden and the shelves sit under the feed as before. GET only.
 * Build 8 (owner-approved 2026-11-15, cook r08 home): the search pill and the category pills stay pinned while the lanes scroll.
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
      const second = block.querySelectorAll('section')[1]
      // The heading's TEXT: a category lane's h2 holds a button (and a 16px glyph), so read the element that carries the words.
      const h2el = second.querySelector('h2')!
      const walk = document.createTreeWalker(h2el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) })
      const h2b = getComputedStyle((walk.nextNode()?.parentElement ?? h2el) as Element)
      return {
        aboveToolbar: block.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().top,
        aboveGrid: block.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top,
        card0: { left: cards[0].left, width: cards[0].width },
        step: cards[1].left - cards[0].left,
        secondPeeks: cards[1].left < innerWidth && cards[1].right > innerWidth,
        square: Math.abs(photo.width - photo.height) <= 1,
        heading: [h2.fontSize, h2.lineHeight],
        heading2: [h2b.fontSize, h2b.lineHeight],
        beams: [...block.querySelectorAll('.rail-beam')].filter((b) => b.getClientRects().length > 0).length,
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
    // Build 7 (owner-approved 2026-11-15): the lead lane's heading is the page's one display line, every other lane's the h2
    // role, and no lane draws a swipe beam on a phone.
    expect(geo.heading).toEqual(['28px', '34px'])
    expect(geo.heading2).toEqual(['22px', '28px'])
    expect(geo.beams).toBe(0)
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

  // ⛔ Build 8 (owner-approved 2026-11-15, cook r08 home): the header stays put and the category pills pin under it while the
  // lanes scroll — whole pills ending 8px or more before the More disc, one hairline once pinned — and let go before the
  // feed's own sticky strip; every lane's See all is the 32px arrow disc; Partners and the flyer lanes come after the
  // product lanes.
  test('build 8: the pinned search + pills bar, whole pills before the disc, arrow discs, product lanes first', async ({ page }) => {
    test.skip(!phone(page.viewportSize()?.width), 'phone only')
    await page.goto('/')
    await expect(page.locator('[data-home-lanes]')).toBeVisible()
    const rest = await page.evaluate(() => {
      const header = document.getElementById('app-header')!.getBoundingClientRect()
      const rail = document.querySelector<HTMLElement>('[data-category-rail]')!
      const scroller = rail.querySelector<HTMLElement>('[role="group"]')!
      const disc = rail.querySelector<HTMLElement>('button[aria-label="More"]')!.getBoundingClientRect()
      const pills = [...scroller.querySelectorAll<HTMLElement>('[data-cat],[data-shortcut],[data-intent]')].map((p) => p.getBoundingClientRect())
      const shown = pills.filter((r) => r.right > 0 && r.left < innerWidth)
      // Trending and Outstanding businesses are the two Shelf lanes (data-shelf), told apart by their place in the server's
      // fixed set: Trending leads, the businesses shelf comes after Partners (this spec runs in English).
      const lanes = [...document.querySelectorAll('[data-home-lanes] > *')].map((el) => {
        if (el.hasAttribute('data-partner-band')) return 'partners'
        const name = el.querySelector('h2')?.textContent?.trim() ?? ''
        if (/^Trending/.test(name)) return 'trending'
        if (/^Outstanding businesses/.test(name)) return 'business'
        return 'lane'
      })
      const seeAll = [...document.querySelectorAll<HTMLElement>('[data-home-lanes] section > div:first-child > :is(a, button):last-child:not(:first-child)')]
        .map((b) => ({ w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), name: b.textContent?.trim() }))
      return {
        railTop: Math.round(rail.getBoundingClientRect().top), headerBottom: Math.round(header.bottom), railH: Math.round(rail.getBoundingClientRect().height),
        position: getComputedStyle(rail).position,
        disc: { left: disc.left, right: disc.right, w: disc.width },
        lastWholeRight: Math.max(...shown.map((r) => r.right)),
        cut: shown.filter((r) => r.left < innerWidth && r.right > innerWidth).length,
        pillH: Math.round(pills[0].height),
        lanes, seeAll, stuck: rail.hasAttribute('data-stuck'),
      }
    })
    expect(rest.position).toBe('sticky')
    expect(rest.railTop).toBe(rest.headerBottom)
    expect(rest.railH).toBe(52)
    expect(rest.pillH).toBe(40)
    expect(rest.disc.w).toBe(40)
    expect(rest.disc.right).toBeCloseTo(page.viewportSize()!.width - 12, 0)
    expect(rest.cut, 'no pill is cut at rest').toBe(0)
    expect(rest.disc.left - rest.lastWholeRight).toBeGreaterThanOrEqual(8)
    expect(rest.stuck).toBe(false)
    expect(rest.lanes[0]).toBe('trending')
    expect(rest.lanes.indexOf('partners')).toBeLessThan(rest.lanes.indexOf('business'))
    expect(rest.lanes.slice(0, rest.lanes.indexOf('partners')).every((l) => l === 'trending' || l === 'lane')).toBe(true)
    for (const b of rest.seeAll) expect(b).toEqual({ w: 32, h: 32, name: 'See all' })
    // Scroll a screen: the header stays, the pills sit right under it with their hairline.
    await page.evaluate(() => window.scrollBy(0, 900))
    await page.waitForTimeout(600)
    const scrolled = await page.evaluate(() => ({
      header: Math.round(document.getElementById('app-header')!.getBoundingClientRect().top),
      rail: Math.round(document.querySelector('[data-category-rail]')!.getBoundingClientRect().top),
      headerBottom: Math.round(document.getElementById('app-header')!.getBoundingClientRect().bottom),
      stuck: document.querySelector('[data-category-rail]')!.hasAttribute('data-stuck'),
    }))
    expect(scrolled.header).toBe(0)
    expect(scrolled.rail).toBe(scrolled.headerBottom)
    // The flag comes from a scroll listener read on the next frame; under a loaded runner hydration can land after the scroll,
    // so wait for it rather than sample it once (it read false twice in a full parallel run, true alone).
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-category-rail]')!.hasAttribute('data-stuck'))).toBe(true)
    // Past the lanes: the pills have let go, and the feed's strip never meets them.
    await page.evaluate(() => { const l = document.querySelector('[data-home-lanes]')!; window.scrollTo(0, l.getBoundingClientRect().bottom + scrollY + 200) })
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => document.querySelector('[data-category-rail]')!.getBoundingClientRect().bottom <= 0)).toBe(true)
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

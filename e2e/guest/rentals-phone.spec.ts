import type { Page } from '@playwright/test'
import { test, expect } from '../helpers'

/**
 * ⛔ RENTAL RESULTS ON A PHONE: ONE COLUMN OF LARGE SQUARE CARDS (owner-approved 2026-11-14, cook r06 rentals-a — listing-grid.ts
 * LISTING_GRID_WIDE, listing-card.tsx `wide`). /c/rentals and the rentals feed (/?category=rentals), below sm:
 *   · each card is the content width with a SQUARE photo — bigger than the two-up card, never smaller (owner, 2026-11-14);
 *   · ⛔ since build 8 (owner-approved 2026-11-15, cook r08 rentals) the text block is three lines in one order on every card — the
 *     28px price row, the title, the info line — and the photo's top is one band: status top-left, the labelled check plate
 *     top-right 12px left of the heart; no price line ever overflows its card, in English or Vietnamese;
 *   · build 8: past the list header the page's own Map control floats as one ink pill, bottom centre, 16px over the tab bar,
 *     while the bar shows — and fades with it while the reader scrolls down;
 *   · ⛔ since build 7 (owner-approved 2026-11-15, cook r07 rentals): a partner's "Official partner" is the white plate on the
 *     photo's top-left — one visible partner mark per card — and the figure is 22px;
 *   · /c/rentals' heading is the display line with its count after it — the total, "5,344 listings" — its one control row
 *     reaches the screen edges, and the free-check line is the list's header 12px under that row;
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
      const band = root.querySelector<HTMLElement>('[data-rail-media] [data-photo-top]')
      const check = band?.querySelector<HTMLElement>('[data-rental-check-toggle]') ?? null
      const heart = root.querySelector<HTMLElement>('[data-rail-media] button[aria-label="Save listing"], [data-rail-media] button[aria-label="Lưu tin"]')
      const shown = (e: Element) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed'
      // Every visible "Official partner" mark on the card (role=img + its name, the plate's and the info line's alike).
      const marks = [...root.querySelectorAll<HTMLElement>('[role="img"]')].filter((e) => /^(?:Official partner|Đối tác chính thức)$/.test(e.getAttribute('aria-label') ?? '') && shown(e))
      const plate = marks.find((e) => !!e.closest('[data-rail-media]'))
      const pr = plate?.getBoundingClientRect()
      const figure = priceRow.querySelector<HTMLElement>('.text-price')
      return {
        x: photo.left, w: photo.width, h: photo.height,
        priceOverflows: priceRow.scrollWidth > priceRow.clientWidth + 1,
        // Visible lines only: a shortened title's full text rides in a zero-height span for the card's description.
        lines: [...body.children].filter((c) => (c as HTMLElement).getBoundingClientRect().height > 0).length,
        slot: !!body.querySelector('[data-trust-slot]'),
        priceRowH: priceRow.getBoundingClientRect().height,
        check: check && check.offsetParent !== null ? (() => {
          const c = check.getBoundingClientRect(), hb = heart!.getBoundingClientRect()
          // The heart's plate is 36px, centred in its 44px box.
          return { h: c.height, dy: c.top - photo.top, toHeart: (hb.left + (hb.width - 36) / 2) - c.right, overflows: check.scrollWidth > check.clientWidth + 1 }
        })() : null,
        partnerMarks: marks.length,
        plate: pr ? { dx: pr.left - photo.left, dy: pr.top - photo.top, h: pr.height } : null,
        // A figure only: a word price ("Contact for price") keeps 17/22.
        figurePx: figure && /\d/.test(figure.textContent ?? '') ? parseFloat(getComputedStyle(figure).fontSize) : null,
        // One visible check toggle per card at most (the photo's copy is display:none below sm).
        toggles: [...root.querySelectorAll<HTMLElement>('[data-rental-check-toggle]')].filter((t) => t.offsetParent !== null).length,
      }
    }))
  }

  for (const [name, path] of [['/c/rentals', '/c/rentals'], ['the rentals feed', '/?category=rentals']] as const) {
    test(`${name}: square cards the content width, three lines in one order, the check on the photo, no price overflow, no sideways scroll`, async ({ page }) => {
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
        expect(c.slot, 'no slot after the price (build 8)').toBe(false)
        expect(c.lines, 'price · title · info line').toBe(3)
        expect(Math.round(c.priceRowH), 'the price row is 28px on every card').toBe(28)
        if (c.check) {
          expect(Math.round(c.check.h), 'the check plate is 36px').toBe(36)
          expect(Math.abs(c.check.dy - 12), 'the check sits on the 12px top edge').toBeLessThanOrEqual(1)
          expect(Math.abs(c.check.toHeart - 12), 'the check ends 12px left of the heart\'s plate').toBeLessThanOrEqual(1)
          expect(c.check.overflows).toBe(false)
        }
        expect(c.toggles).toBeLessThanOrEqual(1)
        expect(c.partnerMarks, 'one visible partner mark per card').toBeLessThanOrEqual(1)
        if (c.partnerMarks === 1) {
          expect(c.plate, 'the partner mark is the photo plate').not.toBeNull()
          expect(Math.abs(c.plate!.dx - 12)).toBeLessThanOrEqual(1)
          expect(c.plate!.dy).toBeGreaterThanOrEqual(11)
          expect(Math.round(c.plate!.h)).toBe(28)
          // Under the check's 36px row when the card has one (build 8): 12 + 36 + 10.
          if (c.check) expect(Math.abs(c.plate!.dy - 58)).toBeLessThanOrEqual(1)
        }
        if (c.figurePx != null) expect(c.figurePx, 'the figure is 22px').toBe(22)
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
    // The total in words, never "48 of 5,344" (build 7).
    await expect(count).toHaveText(/^[\d.,]+ (?:listings?|tin đăng)$/)
    // The free-check line: the list's own header, 12px under the row's hairline, before the first card.
    const head = await page.locator('[data-list-head]').evaluate((el) => {
      const strip = el.previousElementSibling as HTMLElement
      const card = document.querySelector<HTMLElement>('main [data-card-root]')!
      return {
        afterStrip: strip.hasAttribute('data-pinned-strip'),
        gap: el.getBoundingClientRect().top - strip.getBoundingClientRect().bottom,
        h: el.getBoundingClientRect().height,
        toCard: card.getBoundingClientRect().top - el.getBoundingClientRect().bottom,
        link: !!el.querySelector('a[href="/rentals/check"]'),
      }
    })
    expect(head.afterStrip).toBe(true)
    expect(Math.abs(head.gap - 12)).toBeLessThanOrEqual(1)
    expect(Math.round(head.h)).toBe(24)
    expect(Math.abs(head.toCard - 16)).toBeLessThanOrEqual(1)
    expect(head.link).toBe(true)
  })

  /**
   * ⛔ THE MAP FLOATS ONCE THE HEAD IS GONE (owner-approved 2026-11-15 (build 8), cook r08 rentals — map-float.ts): in the head the
   * Map is where it always was; past it the same control is one ink pill bottom centre, 16px over the tab bar, while the bar
   * shows; scrolling down the cards fades it with the bar. Wheel scrolls, so the header/tab-bar hook sees real direction.
   */
  for (const [name, path, sel] of [
    ['/c/rentals', '/c/rentals', '[data-pinned-strip] a[href*="view=map"]'],
    ['the rentals feed', '/?category=rentals', '#results [data-view-cluster] button[aria-label="Map view"]'],
  ] as const) {
    test(`${name}: past the head the Map control floats over the tab bar and rides it`, async ({ page }) => {
      await page.goto(path)
      await page.locator('main [data-card-root]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      if ((await page.locator(sel).count()) === 0) test.skip(true, 'no Map control on this build (no districts / no map)')
      const geo = () => page.locator(sel).evaluate((el) => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el)
        const nav = document.querySelector<HTMLElement>('nav.mobile-nav')!.getBoundingClientRect()
        return { pos: s.position, opacity: Number(s.opacity), h: r.height, centre: r.left + r.width / 2, w: innerWidth, overNav: nav.top - r.bottom, text: (el.textContent ?? '').trim() }
      })
      expect((await geo()).pos).not.toBe('fixed')
      await page.mouse.move(195, 500)
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(80) }
      await page.waitForTimeout(400)
      // Scrolling down: the bar is away, and so is the pill.
      const down = await geo()
      expect(down.pos).toBe('fixed')
      expect(down.opacity).toBe(0)
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(600)
      const up = await geo()
      expect(up.pos).toBe('fixed')
      expect(up.opacity).toBe(1)
      expect(Math.round(up.h)).toBe(48)
      expect(Math.abs(up.centre - up.w / 2)).toBeLessThanOrEqual(1)
      expect(Math.abs(up.overNav - 16)).toBeLessThanOrEqual(1)
      expect(up.text).toMatch(/^(?:Map|Map view|Bản đồ)$/)
      // Back to the top: the control is in its row again.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(400)
      expect((await geo()).pos).not.toBe('fixed')
    })
  }

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
  expect(await page.locator('main [data-trust-slot]').count()).toBe(0)
  // No floated Map from sm, and the band's phone check is display:none.
  expect(await page.locator('main [data-photo-top] [data-rental-check-toggle]').filter({ visible: true }).count()).toBe(0)
})

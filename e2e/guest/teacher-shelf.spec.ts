import type { Page } from '@playwright/test'
import { test, expect, dismissOverlays, expectedEdition, viPilotOn } from '../helpers'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '../../src/lib/teachers/constants'

/**
 * THE HOME "FIND A TEACHER" SHELF (owner, 2026-10-13 — "make teacher profiles more visible on the home page").
 * src/components/marketplace/teacher-shelf.tsx, seeded by src/lib/core/teacher-shelf.ts, placed by listings-explorer.tsx
 * FIRST UNDER THE CATEGORIES, above the feed and outside its grid, since 2026-10-28 (owner: the home page leads with what
 * keeps the reader in the app). It was a row after the twelfth feed card.
 *
 * ⛔ THE SHELF'S CARDS ARE CARD LINKS AND NOW COME FIRST IN DOM ORDER, so every spec that opens "the first card" (or the
 * first 8/10/12) of the HOME page reads them from `.feed-grid a[data-card-link]` — icons-and-fold.spec.ts, a11y.spec.ts,
 * listing.spec.ts, pdp-fold.spec.ts and lang-vi-links.spec.ts. The shelf is asserted to be outside that grid here.
 *
 * ⛔ READ-ONLY: every non-GET request is aborted (a local preview reads the PRODUCTION database, and analytics beacons
 * and the translate endpoint are POSTs). Set E2E_BASE; one edition at a time (preview:vn, then preview:forum).
 * ⚠️ SKIPS — VISIBLY — when fewer than three teachers are live (the shelf's floor): asked of /api/listings itself, so a
 * shelf that is missing for any OTHER reason fails instead of skipping.
 */

/**
 * Live teacher listings the shelf may show, from the public listings API — with the shelf's own rules: never the demo
 * profile, and never a card without its first photo (src/lib/core/teacher-shelf.ts). ⚠️ The ISR HTML can trail the API
 * by its window (a profile published since it was baked), so a target near the floor may still disagree; the floor is
 * three and 33 were live on 2026-10-13.
 */
async function liveTeachers(page: Page): Promise<number> {
  const res = await page.request.get(`/api/listings?category=teachers&limit=12&e2e=${Date.now()}`)
  expect(res.status(), '/api/listings?category=teachers').toBe(200)
  const body = (await res.json()) as { listings?: Array<{ id: string; images?: unknown[] }> }
  return (body.listings ?? [])
    .filter((l) => !(HOME_HIDDEN_TEACHER_LISTING_IDS as readonly string[]).includes(l.id))
    .filter((l) => typeof l.images?.[0] === 'string' && l.images[0] !== '')
    .length
}

const shelf = (page: Page) => page.locator('[data-teacher-shelf]')

/** The home page, overlays dismissed. */
async function openHome(page: Page, path = '/') {
  const res = await page.goto(path)
  await dismissOverlays(page)
  return res
}

test.describe('Guest · home "Find a teacher" shelf', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
    test.skip((await liveTeachers(page)) < 3, 'fewer than three live teacher profiles — below the shelf\'s floor, so no shelf to test')
  })

  test('leads the feed — above its heading row, outside the grid — holds ≥3 profile cards, and the first one is the LCP preload', async ({ page }) => {
    await openHome(page)
    await expect(shelf(page)).toHaveCount(1)
    const order = await page.evaluate(() => {
      const s = document.querySelector('[data-teacher-shelf]')!
      const results = document.querySelector('#results')!
      const grid = document.querySelector('.feed-grid')!
      const firstImg = s.querySelector('img')
      const firstCard = firstImg?.closest('[data-card-root]') ?? null
      return {
        beforeResults: !!(s.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING),
        inGrid: grid.contains(s),
        shelfLinks: [...s.querySelectorAll('a[data-card-link]')].map((a) => a.getAttribute('href') ?? ''),
        feedCardsInShelf: s.querySelectorAll('[data-feed-card]').length,
        firstImgPriority: firstImg?.getAttribute('fetchpriority') ?? null,
        // High-priority images anywhere but the shelf's first card (the card may draw more than one image).
        highPriorityElsewhere: [...document.querySelectorAll('img[fetchpriority="high"]')].filter((i) => !firstCard?.contains(i)).length,
      }
    })
    expect(order.beforeResults, 'the shelf comes before the feed\'s heading row').toBe(true)
    expect(order.inGrid, 'the shelf is not a row of the feed grid').toBe(false)
    expect(order.feedCardsInShelf).toBe(0)
    // The page's one LCP hint moved to the shelf's first photo (feed card 0 keeps eager loading only).
    expect(order.firstImgPriority).toBe('high')
    expect(order.highPriorityElsewhere, 'no other image claims high priority (feed card 0 gave the hint up)').toBe(0)
    expect(order.shelfLinks.length).toBeGreaterThanOrEqual(3)
    for (const href of order.shelfLinks) expect(href).toMatch(/^\/listings\/[^/?#]+$/)
    for (const id of HOME_HIDDEN_TEACHER_LISTING_IDS) expect(order.shelfLinks).not.toContain(`/listings/${id}`)
  })

  test('"See all" opens /c/teachers, and the door goes to the sign-up form on teacher.<edition host>', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    await openHome(page)
    const s = shelf(page)
    await expect(s.getByRole('heading', { level: 2 })).toHaveText('Find a teacher')
    await expect(s.getByRole('link', { name: /See all/ })).toHaveAttribute('href', '/c/teachers')
    // A guest has no profile and no draft: the door is the sign-up form, on its own host, edition-aware.
    const door = s.locator('a[data-cross-link="home-teacher-join"]')
    await expect(door).toHaveCount(1)
    expect(new URL((await door.getAttribute('href'))!).hostname).toBe(edition === 'marketplace' ? 'teacher.eno.vn' : 'teacher.eno.forum')
  })

  test('no horizontal page overflow at 360px and 390px — the rail scrolls inside its own row', async ({ page }) => {
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await openHome(page)
      await shelf(page).scrollIntoViewIfNeeded()
      const m = await page.evaluate(() => {
        const box = document.querySelector('[data-teacher-shelf]')!.getBoundingClientRect()
        return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, right: box.right, left: box.left }
      })
      expect(m.doc, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(m.vw)
      expect(m.left, `shelf starts off-screen at ${width}px`).toBeGreaterThanOrEqual(0)
      expect(m.right, `shelf overflows at ${width}px`).toBeLessThanOrEqual(m.vw + 0.5)
    }
  })

  test('the Vietnamese home titles it "Tìm giáo viên" — /vi on the pilot, / with the choice elsewhere', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    if (!baseURL) throw new Error('no baseURL')
    await page.context().addCookies([{ name: 'lang', value: 'vi', url: baseURL }])
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'vi') } catch { /* private mode */ } })
    await openHome(page, viPilotOn(edition) ? '/vi' : '/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    await expect(shelf(page).getByRole('heading', { level: 2 })).toHaveText('Tìm giáo viên')
  })

  /**
   * ⛔ A PERSON'S NAME IS NEVER MACHINE-TRANSLATED (src/lib/core/teacher-shelf.ts). Korean is one of the languages whose
   * listing titles the nightly cron pre-warms, so before the pin a teacher's name arrived ALREADY TRANSLATED inside the
   * page's own embed — deterministic, no client request to wait for. `html[lang=ko]` is set by the provider's effect
   * after the commit in which every card re-rendered in Korean, so once it holds, the titles are the Korean ones.
   * ⚠️ THE ORACLE IS THE SAME DOCUMENT'S SERVER HTML — the English variant, where every name renders as typed — not the
   * listings API: the API reads the database live, so a teacher who renamed themselves since this copy was baked would
   * fail a correct page. Same document, same cards, before and after the switch.
   * (The languages translated on view, and English for a Vietnamese-letter name, are client requests — an absence an
   * e2e cannot time; the unit test drives the card's own localizedPlan through all eleven instead.)
   */
  test('under Korean, every card keeps the name its server HTML printed — never a translation of it', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'ko') } catch { /* private mode */ } })
    const res = await openHome(page)
    const serverHtml = await res!.text()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko', { timeout: 20_000 })
    const [served, shown] = await page.evaluate((html) => {
      // Each shelf card's link and full title (the h3's `title` — the line itself may be shortened, card-title.ts).
      const read = (root: ParentNode) => [...root.querySelectorAll('[data-teacher-shelf] [data-card-root]')].map((card) => [
        card.querySelector('a[data-card-link]')?.getAttribute('href') ?? '',
        card.querySelector('h3')?.getAttribute('title') ?? '',
      ])
      return [read(new DOMParser().parseFromString(html, 'text/html')), read(document)]
    }, serverHtml)
    expect(served.length, 'shelf cards in the server HTML').toBeGreaterThanOrEqual(3)
    expect(served.every(([href, name]) => href.startsWith('/listings/') && name !== ''), 'every served card has a link and a name').toBe(true)
    expect(shown, 'the Korean page shows the names the server printed, card for card').toEqual(served)
  })

  /**
   * ⛔ ABOVE THE FEED, A SHELF HYDRATION REMOVES WOULD MOVE THE WHOLE GRID. The ISR HTML is the same document for every
   * query string, so the shelf is in each one's server HTML; on a masked URL (explorer-url.ts MASK_KEYS) globals.css
   * gives it `display: none` before the first paint, and hydration then unmounts it — a box that was never laid out.
   * ⚠️ THE FIRST PAINT IS OBSERVED WITH THE APP'S JS BLOCKED (codex, commit gate 2026-10-28): the inline pre-paint script
   * still runs, hydration never does, so what is measured is the server HTML under the mask — not a page hydration may
   * already have changed. Then, with JS, what hydration leaves.
   */
  for (const url of ['/?q=laptop', '/?category=rentals', '/?sort=recent']) {
    test(`${url}: the shelf takes no space before hydration, and is gone after it`, async ({ page }) => {
      test.slow() // two cold loads of the home document, one with its JS blocked
      // JS only: the stylesheets are chunks too, and the mask is a CSS rule.
      await page.route('**/_next/static/chunks/**/*.js', (r) => r.abort())
      await page.goto(url)
      const before = await page.evaluate(() => {
        const s = document.querySelector('[data-teacher-shelf]')
        return { inDom: !!s, height: s ? s.getBoundingClientRect().height : -1, masked: document.documentElement.hasAttribute('data-explorer-directed') }
      })
      expect(before, 'the server HTML carries the shelf, masked and out of the layout').toEqual({ inDom: true, height: 0, masked: true })
      await page.unroute('**/_next/static/chunks/**/*.js')
      await page.goto(url)
      await expect(shelf(page), 'the shelf after hydration').toHaveCount(0, { timeout: 30_000 })
      // The sort really was applied once the explorer hydrated: the feed's heading names it.
      if (url.includes('sort=')) await expect(page.getByRole('heading', { name: 'Latest listings', exact: true }).first()).toBeVisible({ timeout: 30_000 })
    })
  }

  test('the default order spelled out (?sort=newest) is the seed itself: unmasked, the shelf laid out before and after hydration', async ({ page }) => {
    test.slow()
    await page.route('**/_next/static/chunks/**/*.js', (r) => r.abort())
    await page.goto('/?sort=newest')
    const before = await page.evaluate(() => ({
      masked: document.documentElement.hasAttribute('data-explorer-directed'),
      height: document.querySelector('[data-teacher-shelf]')?.getBoundingClientRect().height ?? 0,
    }))
    expect(before.masked).toBe(false)
    expect(before.height).toBeGreaterThan(0)
    await page.unroute('**/_next/static/chunks/**/*.js')
    await openHome(page, '/?sort=newest')
    await expect(shelf(page)).toBeVisible({ timeout: 20_000 })
  })
})

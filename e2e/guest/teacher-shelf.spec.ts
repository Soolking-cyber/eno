import type { Page } from '@playwright/test'
import { test, expect, dismissOverlays, expectedEdition, viPilotOn } from '../helpers'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '../../src/lib/teachers/constants'

/**
 * THE HOME "FIND A TEACHER" SHELF (owner, 2026-10-13 — "make teacher profiles more visible on the home page"; picked:
 * a shelf after the feed's first twelve listings). src/components/marketplace/teacher-shelf.tsx, seeded by
 * src/lib/core/teacher-shelf.ts, placed by listings-explorer.tsx after the twelfth feed card.
 *
 * ⛔ IT PINS THE ORDER OTHER SPECS ASSUME. icons-and-fold.spec.ts, a11y.spec.ts, listing.spec.ts, pdp-fold.spec.ts and
 * lang-vi-links.spec.ts all open "the first card" (or the first 8/10/12) off the home page by `a[data-card-link]` in
 * DOM order. The shelf's cards are card links too, so they must never come before the twelfth feed card — asserted here.
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

/**
 * The home page with its first feed page in place. The shelf sits after the TWELFTH feed card, so a feed shorter than
 * a page has none — a catalogue state, not a regression (the guest capture row has the same rule): skipped, visibly.
 */
async function openHome(page: Page, path = '/') {
  await page.goto(path)
  await dismissOverlays(page)
  const feedCards = await page.locator('.feed-grid > [data-feed-card]').count()
  test.skip(feedCards < 12, `the home feed holds ${feedCards} cards — fewer than a page, so there is no slot after the twelfth`)
}

test.describe('Guest · home "Find a teacher" shelf', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
    test.skip((await liveTeachers(page)) < 3, 'fewer than three live teacher profiles — below the shelf\'s floor, so no shelf to test')
  })

  test('sits right after the twelfth feed card, holds ≥3 profile cards, and none of the first twelve card links is in it', async ({ page }) => {
    await openHome(page)
    await expect(shelf(page)).toHaveCount(1)
    const order = await page.evaluate(() => {
      const s = document.querySelector('[data-teacher-shelf]')!
      const feed = [...document.querySelectorAll('.feed-grid > [data-feed-card]')]
      const links = [...document.querySelectorAll('a[data-card-link]')]
      return {
        afterTwelfth: feed.length >= 12 && s.previousElementSibling === feed[11],
        inGrid: s.parentElement?.classList.contains('feed-grid') ?? false,
        firstTwelveInShelf: links.slice(0, 12).filter((a) => s.contains(a)).length,
        shelfLinks: [...s.querySelectorAll('a[data-card-link]')].map((a) => a.getAttribute('href') ?? ''),
        feedCardsInShelf: s.querySelectorAll('[data-feed-card]').length,
      }
    })
    expect(order.inGrid, 'the shelf is a row of the feed grid').toBe(true)
    expect(order.afterTwelfth, 'the shelf follows the twelfth [data-feed-card]').toBe(true)
    expect(order.firstTwelveInShelf, 'the first twelve card links stay feed cards (other specs open "the first card")').toBe(0)
    expect(order.feedCardsInShelf).toBe(0)
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

  test('after hydration: gone on a search and on a category, still there under a sort', async ({ page }) => {
    // The ISR HTML is the same document for every query string, so the shelf is IN the first paint of each (masked on
    // a directed link — globals.css); what counts is what hydration leaves.
    for (const url of ['/?q=laptop', '/?category=rentals']) {
      await page.goto(url)
      await expect(shelf(page), `${url} keeps the shelf after hydration`).toHaveCount(0, { timeout: 20_000 })
    }
    await page.goto('/?sort=recent')
    // The sort is applied only once the explorer has hydrated and read its URL: the feed's heading names it.
    await expect(page.getByRole('heading', { name: 'Latest listings', exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(shelf(page)).toHaveCount(1)
    await expect(shelf(page)).toBeVisible()
  })
})

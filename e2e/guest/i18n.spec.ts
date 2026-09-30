import type { Page } from '@playwright/test'
import { test, expect } from '../helpers'

// Language pipeline for guests. There's no header language selector when logged out — the UI
// language is driven by localStorage 'lang' (mirrored to a cookie). We seed it BEFORE load and
// assert the category labels localize. (addInitScript runs before the app's scripts.)
//
// ⚠️ THE HOME CATEGORY TILES ARE LINKS, NOT BUTTONS (E-TILES, 2026-09-29): `<a href="/?category=…">`
// through `Button asChild`, a plain click still filtering in place (category-rail.tsx `tile`). So the
// tiles are queried by role `link` INSIDE the rail — the scroller is `role="group"` named by its own
// localized label — because a page-wide link query also meets the footer's "Explore" list, which
// carries the same category names (two "Electronics" links on desktop: the tile and /c/electronics).
// The href pins the tile to its slug, so the localized label is proven to be THAT category's.
const categoryRail = (page: Page, name: string) => page.getByRole('group', { name, exact: true })

test.describe('Guest · language pipeline', () => {
  test('renders Vietnamese when lang=vi', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'vi') } catch { /* */ } document.cookie = 'lang=vi; path=/' })
    await page.goto('/')
    // The rail's own accessible name localizes too ("Categories" → "Danh mục").
    const tile = categoryRail(page, 'Danh mục').getByRole('link', { name: /Điện tử/ }) // "Electronics" in VI
    await expect(tile).toBeVisible()
    await expect(tile).toHaveAttribute('href', /[?&]category=electronics(?:&|$)/)
    // No English label anywhere on the page, whichever role the tile is rendered with (link or button).
    await expect(page.locator('a:visible, button:visible', { hasText: /^Electronics$/ })).toHaveCount(0)
  })

  test('renders English when lang=en', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch { /* */ } document.cookie = 'lang=en; path=/' })
    await page.goto('/')
    const tile = categoryRail(page, 'Categories').getByRole('link', { name: /Electronics/ })
    await expect(tile).toBeVisible()
    await expect(tile).toHaveAttribute('href', /[?&]category=electronics(?:&|$)/)
  })
})

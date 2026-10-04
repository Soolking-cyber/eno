import type { Page } from '@playwright/test'
import { test, expect, expectedEdition, viPilotOn, ADAPTIVE_PAGE, serverHtmlLang } from '../helpers'

// Language pipeline for guests. There's no header language selector when logged out — the UI
// language is driven by localStorage 'lang' (mirrored to a cookie). We seed it BEFORE load and
// assert the category labels localize.
//
// ⚠️ THE HOME CATEGORY TILES ARE LINKS, NOT BUTTONS (E-TILES, 2026-09-29): `<a href="/?category=…">`
// through `Button asChild`, a plain click still filtering in place (category-rail.tsx `tile`). So the
// tiles are queried by role `link` INSIDE the rail — the scroller is `role="group"` named by its own
// localized label — because a page-wide link query also meets the footer's "Explore" list, which
// carries the same category names (two "Electronics" links on desktop: the tile and /c/electronics).
// The href pins the tile to its slug, so the localized label is proven to be THAT category's.
//
// ⛔ THE VIETNAMESE HOME IS `/vi` ON eno.vn SINCE THE /vi PILOT (2026-10-02, e2e/helpers.ts `viPilotOn`).
// This spec used to load `/` with lang=vi and expect Vietnamese tiles, which the pilot made wrong by
// design: the plain `/` is English for everyone there. eno.forum has no pilot, so its Vietnamese home is
// still `/` with the cookie. Both are asserted, each where it holds.
const categoryRail = (page: Page, name: string) => page.getByRole('group', { name, exact: true })

/**
 * A returning visitor's stored choice: the `lang` cookie ON THE FIRST REQUEST (a context cookie — an init
 * script runs only after the response, so the server would never see it) plus the localStorage choice.
 */
async function seedLang(page: Page, baseURL: string | undefined, lang: 'vi' | 'en') {
  if (!baseURL) throw new Error('no baseURL')
  await page.context().addCookies([{ name: 'lang', value: lang, url: baseURL }])
  await page.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch { /* */ } }, lang)
}

// ⚠️ WHAT THIS SPEC DOES NOT CARRY, ON PURPOSE: that a pinned page leaves a stored choice alone (no cookie
// write, no client swap). That is an ABSENCE after hydration, which an e2e cannot time without a hydration
// signal — two review rounds found each attempt racing it. The provider contract is unit-tested instead:
// src/context/language-context.vi-pilot.test.tsx ("a stored Vietnamese choice on the plain piloted `/`: no
// reload, the state stays en, no cookie written"; "an English choice on `/vi`: no reload, stays vi").

test.describe('Guest · language pipeline', () => {
  test('renders the Vietnamese home when lang=vi — /vi on the pilot, / elsewhere', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    await seedLang(page, baseURL, 'vi')
    await page.goto(viPilotOn(edition) ? '/vi' : '/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    // The rail's own accessible name localizes too ("Categories" → "Danh mục").
    const tile = categoryRail(page, 'Danh mục').getByRole('link', { name: /Điện tử/ }) // "Electronics" in VI
    await expect(tile).toBeVisible()
    await expect(tile).toHaveAttribute('href', /[?&]category=electronics(?:&|$)/)
    // No English label anywhere on the page, whichever role the tile is rendered with (link or button).
    await expect(page.locator('a:visible, button:visible', { hasText: /^Electronics$/ })).toHaveCount(0)
  })

  test('lang=vi: the SERVER renders an adaptive page in Vietnamese on every edition', async ({ page, baseURL }) => {
    await seedLang(page, baseURL, 'vi')
    const res = await page.goto(ADAPTIVE_PAGE)
    expect(serverHtmlLang(await res!.text()), 'the first response, not a client swap').toBe('vi')
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
  })

  test('the pinned / stays English with lang=vi on the pilot; eno.forum\'s / follows the choice', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    await seedLang(page, baseURL, 'vi')
    const res = await page.goto('/')
    const expected = viPilotOn(edition) ? 'en' : 'vi'
    expect(serverHtmlLang(await res!.text()), 'the first response, not a client swap').toBe(expected)
    await expect(page.locator('html')).toHaveAttribute('lang', expected)
    if (viPilotOn(edition)) await expect(categoryRail(page, 'Categories').getByRole('link', { name: /Electronics/ })).toBeVisible()
    else await expect(categoryRail(page, 'Danh mục').getByRole('link', { name: /Điện tử/ })).toBeVisible()
  })

  test('/vi stays Vietnamese with lang=en on the pilot — the twin does not negotiate either', async ({ page, baseURL }) => {
    const edition = await expectedEdition(page, baseURL)
    test.skip(!viPilotOn(edition), 'eno.forum has no /vi twin (asserted in lang-detect.spec.ts)')
    await seedLang(page, baseURL, 'en')
    const res = await page.goto('/vi')
    expect(serverHtmlLang(await res!.text())).toBe('vi')
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    await expect(categoryRail(page, 'Danh mục').getByRole('link', { name: /Điện tử/ })).toBeVisible()
  })

  test('renders English when lang=en', async ({ page, baseURL }) => {
    await seedLang(page, baseURL, 'en')
    await page.goto('/')
    const tile = categoryRail(page, 'Categories').getByRole('link', { name: /Electronics/ })
    await expect(tile).toBeVisible()
    await expect(tile).toHaveAttribute('href', /[?&]category=electronics(?:&|$)/)
  })
})

import type { Browser, Page } from '@playwright/test'
// `test` from helpers seeds the cookie-consent choice before navigation, so the first-visit dialog
// never sits over the search box the last test types into.
import { test, expect } from '../helpers'
import { SITE_NAME } from '../../src/lib/edition'
import { LEDE_PLACEMENT } from '../../src/app/[lang]/c/[category]/(index)/lede-placement'

// ─────────────────────────────────────────────────────────────────────────────
// WHAT A CRAWLER READS, WITHOUT JAVASCRIPT (SEO wave B, H2; pins H1a, H1b and H1c).
//
// A route `loading.tsx` wraps its page in a Suspense boundary, and React moves a finished boundary
// over 500 B into `<div hidden id="S:0">` at the end of the body whenever the shell's bytes plus the
// boundary's pass 12,800 B, which on these pages is always, cached HTML and bots included (the rule
// and its source lines are in src/app/[lang]/crawler-visible-html-contract.test.ts). Only an inline
// script reveals it. Until wave B every crawler got, on the home, category and listing pages, the H1
// under `[hidden]`, the header, `<main>` and search box twice (the skeleton's and the page's), and as
// visible text the skeleton's header and footer.
// The fix, and what this spec holds it to:
//  - the listing page has no loading boundary (H1a): nothing on it is hidden;
//  - the category page (H1b) and home (H1c) keep a skeleton for the grid, the owner's hybrid, so
//    their header, `<main>`, breadcrumb, H1 and (per LEDE_PLACEMENT) lede render in a segment layout
//    above the boundary. `S:0` is still there, holding the grid, and that is correct.
// The contract test pins the files; this reads the HTML the server actually sends, the way a crawler
// does, so a boundary added inside a component (which no file check can see) fails here too.
//
// ⛔ Fixture-backed like the rest of e2e/ci (scripts/ci-fixtures.ts). Never point E2E_CI_BASE at
// production.
// ─────────────────────────────────────────────────────────────────────────────

/** The four crawlers the live measurement used (plan v4, H2), by the user agent each sends. */
const CRAWLERS: [string, string][] = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['OAI-SearchBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot)'],
  ['PerplexityBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  ['bingbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36'],
]

const HOME = '/'
const CATEGORY = '/c/electronics'
/** A plain electronics fixture with no `affiliateUrl`. */
const LISTING = '/listings/ci-l-1'
/** The fixture category's English name (ci-fixtures.ts upserts it from src/lib/taxonomy.ts). */
const CATEGORY_NAME = 'Electronics'

/**
 * ⚠️ EXACTLY THESE SELECTORS; DO NOT BROADEN THEM. React writes an outlined boundary as
 * `<div hidden id="S:n">` and its placeholder as `<template id="B:n">`. An errored `ssr:false`
 * boundary (every `next/dynamic` with `ssr: false` renders client-side by design) is written in place
 * as `<!--$!--><template data-dgst=…>` with NO id (next/dist/compiled/react-dom/cjs/
 * react-dom-server.node.production.js:6945-6962, React 19.2.8 as Next 16.3.6 ships it), and a wider
 * selector would fail the listing page on those.
 */
const OUTLINED = 'div[hidden][id^="S:"]'
const PLACEHOLDER = 'template[id^="B:"]'

/** The server's HTML as a crawler that runs no JavaScript sees it: React's reveal script never runs. */
async function crawl(browser: Browser, userAgent: string, path: string): Promise<Page> {
  const ctx = await browser.newContext({ javaScriptEnabled: false, userAgent, locale: 'en-US' })
  const page = await ctx.newPage()
  const res = await page.goto(path)
  expect(res?.status(), `${path} must answer 200`).toBe(200)
  return page
}

/** Whether the element (the first match) sits under any `[hidden]` ancestor, itself included. */
const underHidden = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => !!el.closest('[hidden]'))

/**
 * The footer's link groups (footer.tsx, ui/accordion with hiddenUntilFound). React SSRs each closed
 * panel as a plain `hidden=""`, and Base UI switches it to `until-found` only after hydration, so with
 * JavaScript off the footer's link text sits under [hidden]. That is the footer's own contract, not
 * the page's (globals.css forces the panels open from 40rem, and the links stay in the HTML), so it is
 * pinned separately below and left out of the page's hidden-word count.
 */
const FOOTER_PANEL = '#app-footer [data-slot="accordion-panel"]'

/** Words in text under `[hidden]`, leaving out script, style, template and noscript (not page text) and the footer panels' link text. */
const hiddenWords = (page: Page) =>
  page.evaluate((footerPanel) => {
    let n = 0
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const el = t.parentElement
      if (!el || el.closest('script, style, template, noscript') || !el.closest('[hidden]')) continue
      // Only a footer panel's LINK text is exempt: any other text put in a panel still counts.
      if (el.closest(footerPanel) && el.closest('a[href]')) continue
      n += (t.textContent ?? '').split(/\s+/).filter(Boolean).length
    }
    return n
  }, FOOTER_PANEL)

test.describe('crawler-visible HTML, JavaScript off', () => {
  for (const [bot, userAgent] of CRAWLERS) {
    for (const path of [HOME, CATEGORY, LISTING]) {
      test(`${bot} ${path}: one visible H1, one header, one <main>, one search box`, async ({ browser }) => {
        const page = await crawl(browser, userAgent, path)
        // Every <h1> in the document, hidden ones included: a second copy in S:0 is the regression.
        await expect(page.locator('h1')).toHaveCount(1)
        expect(await underHidden(page, 'h1'), 'the H1 must not be under [hidden]').toBe(false)
        await expect(page.locator('[id="app-header"]')).toHaveCount(1)
        await expect(page.locator('[id="main"]')).toHaveCount(1)
        await expect(page.locator('[id="app-header"] input[name="q"]')).toHaveCount(1)
        await page.context().close()
      })
    }

    test(`${bot} ${LISTING}: nothing outlined, no word under [hidden]`, async ({ browser }) => {
      const page = await crawl(browser, userAgent, LISTING)
      await expect(page.locator(OUTLINED)).toHaveCount(0)
      await expect(page.locator(PLACEHOLDER)).toHaveCount(0)
      expect(await hiddenWords(page)).toBe(0)
      // The footer's links are still in the HTML a crawler reads, each an <a href> (followable), and
      // from 40rem up the panels holding them display (globals.css), so a desktop crawler sees them.
      expect(await page.locator(`${FOOTER_PANEL} a[href]`).count()).toBeGreaterThan(0)
      await page.setViewportSize({ width: 1280, height: 900 })
      const shown = await page.locator(FOOTER_PANEL).evaluateAll((els) => els.every((el) => getComputedStyle(el).display !== 'none'))
      expect(shown, 'from 40rem every footer link panel must display with JavaScript off').toBe(true)
      await page.context().close()
    })

    test(`${bot} ${CATEGORY}: H1, breadcrumb and lede above the skeleton (lede: ${LEDE_PLACEMENT})`, async ({ browser }) => {
      const page = await crawl(browser, userAgent, CATEGORY)
      await expect(page.locator('h1')).toContainText(CATEGORY_NAME)
      // The breadcrumb primitive's own markers (ui/breadcrumb: aria-label="breadcrumb", lowercase, and
      // data-slot). The label is the one a screen reader and a crawler read.
      const crumb = 'nav[aria-label="breadcrumb"][data-slot="breadcrumb"]'
      await expect(page.locator(crumb)).toHaveCount(1)
      expect(await underHidden(page, crumb), 'the breadcrumb must not be under [hidden]').toBe(false)
      const lede = '[data-category-lede]'
      await expect(page.locator(lede)).toHaveCount(1)
      // Decision H-c: read from the one constant the layout, the page and the skeleton read.
      if (LEDE_PLACEMENT === 'layout') expect(await underHidden(page, lede), 'the lede must not be under [hidden]').toBe(false)
      else expect(await page.locator(lede).evaluate((el, sel) => !!el.closest(sel), OUTLINED)).toBe(true)
      await page.context().close()
    })

    test(`${bot} ${HOME}: the H1 is the site name`, async ({ browser }) => {
      const page = await crawl(browser, userAgent, HOME)
      // SITE_NAME is decided by NEXT_PUBLIC_ENO_EDITION, read here in the runner and inlined in the
      // server at build time (ci.yml sets it for the whole job). Check they agree first, so a runner
      // without it fails on that and not as a wrong heading.
      await expect(page.locator('meta[property="og:site_name"]'), 'the runner and the build must share NEXT_PUBLIC_ENO_EDITION').toHaveAttribute('content', SITE_NAME)
      await expect(page.locator('h1')).toHaveText(SITE_NAME)
      await page.context().close()
    })
  }
})

/**
 * No hydration error on the pages whose markup wave B moved. A mismatch now re-renders from the
 * nearest boundary, which on the listing page (no boundary since H1a) is the ROOT. Both `pageerror`
 * and the console are read: React 19 reports recoverable errors through reportError.
 */
test.describe('no hydration error under 6x CPU', () => {
  for (const path of [HOME, CATEGORY, LISTING]) {
    test(`${path} hydrates without a React #418/#423/#425/#467 or a "Hydration" message`, async ({ page }) => {
      test.setTimeout(120_000)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`) })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
      await page.goto(path, { waitUntil: 'load', timeout: 90_000 })
      // Hydrated: the header's search form carries a React fiber, and S:0, if the page has one, is revealed.
      await page.waitForFunction(() => {
        const form = document.querySelector('form[role="search"]')
        return !!form && Object.keys(form).some((k) => k.startsWith('__reactFiber')) && !document.querySelector('div[hidden][id^="S:"]')
      }, null, { timeout: 90_000 })
      // Recoverable errors are reported after the commit that hit them; give them two frames and a beat.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 1500)))))
      expect(errors.filter((e) => /#(418|423|425|467)\b|hydrat/i.test(e))).toEqual([])
    })
  }
})

/**
 * ⛔ TEXT TYPED INTO THE SEARCH BOX BEFORE THE PAGE IS REVEALED SURVIVES THE REVEAL (the race
 * e2e/ci/marketplace.spec.ts documents). While the category skeleton drew its own header, the box a
 * visitor typed into on a slow phone was the SKELETON's, and React's reveal replaced the whole
 * skeleton with the page's header and an empty box: Enter then searched nothing. Since H1b the only
 * header is in the layout, above the boundary, so the reveal never touches it.
 * The race is made deterministic, not waited for: an init script holds React's `$RC` (the inline
 * "complete boundary" call) until the text is typed, which is a slow phone's reveal made to last, and
 * the JS chunks stay held throughout, so Enter is the form's native GET (the header's `<form
 * action="/">` carries a hidden `category` input in the server HTML). Three checks keep the hold from
 * passing vacuously, each failing loudly instead of quietly racing again: the page still has at least
 * one pending boundary (with none there is no reveal to race); every pending boundary's `$RC` call was
 * queued (a React that renames `$RC`); and React's own `$RC`, which its inline runtime ASSIGNS
 * (`$RC=function(a,b){…}` in react-dom-server 19.2.8), reached the setter before the release (a runtime
 * that stops assigning it would otherwise leave `S:n` hidden until a timeout).
 */
test('text typed into the category search box before the reveal survives it and is searched', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const queue: unknown[][] = []
    let real: ((...a: unknown[]) => unknown) | undefined
    let open = false
    w.__enoHeldReveals = queue
    w.__enoReleaseReveals = () => {
      open = true
      if (!real) return false
      for (const a of queue.splice(0)) real(...a)
      return true
    }
    Object.defineProperty(window, '$RC', {
      configurable: true,
      get: () => (...a: unknown[]) => (open ? real?.(...a) : void queue.push(a)),
      set: (f: (...a: unknown[]) => unknown) => { real = f },
    })
  })
  let release!: () => void
  const chunks = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, async (route) => { await chunks; await route.continue().catch(() => {}) })
  await page.goto('/c/vehicles', { waitUntil: 'domcontentloaded' })
  // One `$RC("B:n","S:n")` per pending boundary, so count the boundaries' placeholders: an outlined
  // SEGMENT is also a `div[hidden][id^="S:"]`, but React completes it with `$RS` against a `P:n` template.
  const pending = await page.locator(PLACEHOLDER).count()
  expect(pending, 'the category page outlines its grid behind a B:n placeholder, so there is a reveal to race').toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as unknown as { __enoHeldReveals: unknown[] }).__enoHeldReveals.length), 'every pending boundary\'s $RC is held').toBe(pending)
  const box = page.getByRole('search').getByRole('combobox', { name: 'Search' }).filter({ visible: true }).first()
  await box.fill('bicycle')
  expect(await page.evaluate(() => (window as unknown as { __enoReleaseReveals: () => boolean }).__enoReleaseReveals()), "React's $RC was captured, so the release runs it").toBe(true)
  await page.waitForFunction((sel) => !document.querySelector(sel), `${OUTLINED}, ${PLACEHOLDER}`)
  await expect(box, 'the reveal must not replace the box the text was typed into').toHaveValue('bicycle')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/\?(?=.*\bcategory=vehicles\b)(?=.*\bq=bicycle\b)/)
  release()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

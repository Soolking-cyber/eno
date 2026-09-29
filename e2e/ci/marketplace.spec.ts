import net from 'node:net'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// THE FIXTURE-BACKED MARKETPLACE GATE (review Q01).
//
// ⚠️ THIS IS THE SUITE THAT MAY BLOCK A MERGE, WHICH IS WHY IT OWNS ITS OWN DATA.
// The `e2e/guest/**` specs read whatever the target deployment happens to hold, so
// they go red for reasons an author cannot fix — a listing sold, a hide-list change
// — and a gate that cries wolf teaches everyone to re-run until green. Every
// assertion here is against rows `scripts/ci-fixtures.ts` created moments earlier
// in a throwaway Postgres, so a failure means the CODE changed.
//
// ⛔ NEVER point this at production: the assertions below would then be claims about
// real inventory. The workflow builds its own server on :3100 and passes E2E_CI_BASE.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ WAIT FOR HYDRATION, NOT FOR A TIMEOUT. The sort strip and "Show more" are server-rendered and
 * inert until React attaches; a click in that window is swallowed with no error and the test reads
 * as a broken feature. `data-listings-ready` is set by the component's own mount effect.
 */
const ready = (page: import('@playwright/test').Page) =>
  expect(page.locator('[data-listings-ready="true"]').first()).toBeAttached()

/**
 * ⚠️ WAIT FOR THE STREAMED PAGE TO REPLACE ITS SKELETON — DOMContentLoaded DOES NOT MEAN IT HAS.
 * /c/<category> has a loading.tsx, so its cached HTML carries that skeleton, WITH ITS OWN <Header />,
 * and the real page in a hidden `<div id="S:0">` that React's inline `$RC` script swaps in. The swap
 * is throttled: if a frame paints between the shell's `$RT` stamp and `$RC` (a slow runner), it waits
 * on a timer up to 300ms, so it can land AFTER DOMContentLoaded. Text filled in that window goes into
 * the SKELETON's box, which the swap then deletes — no JS runs, hydration never sees it. That was the
 * one-off `Received: ""` in CI on 2026-09-27 (its video shows "bicycle" for ~200ms, then an empty box
 * with no caret). Forcing the throttled path fails the old steps 5/5 and passes 5/5 with this wait.
 * The swap is an inline script, so the JS chunks stay held and the text is still typed pre-hydration.
 * ⚠️ THE SKELETON SWAP IS A REAL PRODUCT RACE, NOT A TEST ARTIFACT: a visitor who types into the
 * skeleton's box in that window loses the text too (forced throttled path: 'the header search on a
 * category landing page' lands on /?category=vehicles with no q, 6/6). It is left open and reported,
 * and that test is deliberately NOT given this wait. The two hydration tests get it because what
 * they assert — text typed before HYDRATION survives it — is a different mechanism, and correct.
 * ⚠️ SINCE SEO WAVE B, H1b, THE CATEGORY SKELETON HAS NO HEADER. The header, breadcrumb and H1 render
 * above it in `c/[category]/(index)/layout.tsx`, so the cached HTML carries ONE header and one search
 * box, outside the boundary, and the swap replaces only what sits under the H1. The paragraphs above
 * describe the page before that. `streamed()` stays: the grid is still swapped in from `S:0`.
 * ⚠️ THE RACE IS CLOSED ON HOME AND CATEGORY PAGES (H1b, H1c): on both, the only header is in the
 * segment layout, above the boundary. e2e/ci/crawler-html.spec.ts (H2) pins it on /c/vehicles with
 * the reveal held until the text is typed, and asserts one header and one search box in the server
 * HTML of home, category and listing pages.
 */
const streamed = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => !document.querySelector('template[id^="B:"], div[hidden][id^="S:"]'))

/** A browser's image Accept header, and the WebP-only one: the optimizer keys its cache on the format. */
const accepts = ['image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'image/webp,*/*']

/**
 * Widths and a quality the optimizer ACCEPTS, read from next.config.ts — the file this build was made
 * from. It checks `url` before `w` and `q`, so an unlisted width would still get the url refusal
 * below, and a control run against an unfixed build would then be refused on the width instead of
 * reading — and never wedge. The quality is the listed one pages do NOT use (the loader's default is
 * 60), so a regression here cannot wedge a variant the page tests above load.
 */
function optimizerParams() {
  const cfg = readFileSync('next.config.ts', 'utf8')
  const list = (key: string) =>
    (new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(cfg)?.[1] ?? '').split(',').map((n) => Number(n.trim())).filter(Boolean)
  const widths = [...list('deviceSizes'), ...list('imageSizes')]
  const quality = list('qualities').find((q) => q !== 60)
  if (widths.length < 2 || !quality) throw new Error(`images.deviceSizes/imageSizes/qualities not found in next.config.ts (${widths} / ${quality})`)
  return { widths, quality }
}

/**
 * What a browser does on navigation: the request goes out, then the socket does, before any answer.
 * ⚠️ A DROP THAT NEVER REACHED THE SERVER MUST FAIL, NOT RESOLVE: the tests below then only re-request,
 * which passes on an unfixed server too. So a base URL without a port uses 80 (it gave `Number('')`
 * = port 0 and a quiet connection error), an https base is refused outright (these are raw-TCP
 * writes; the ci-fixtures server is plain http), and a connection error rejects.
 */
function dropAll(baseURL: string, variants: { path: string; accept: string }[]) {
  const { protocol, hostname, host, port } = new URL(baseURL)
  if (protocol !== 'http:') throw new Error(`dropAll sends raw HTTP/1.1 over TCP; E2E_CI_BASE must be http://, got ${protocol}`)
  const at = Number(port) || 80
  return Promise.all(variants.map(({ path, accept }) => new Promise<void>((resolve, reject) => {
    const s = net.connect(at, hostname, () => {
      // Destroy in the write CALLBACK, i.e. once the request is flushed to the kernel — a destroy()
      // right after write() usually still sends it, but only because libuv happens to write small
      // buffers synchronously; the drop must never depend on that (agy review, 2026-09-27).
      s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: ${accept}\r\n\r\n`, () => {
        s.destroy()
        resolve()
      })
    })
    s.on('error', (e) => reject(new Error(`drop of ${path} never reached ${hostname}:${at} — ${e.message}`)))
  })))
}

const FIXTURES = ['Fixture laptop', 'Fixture phone', 'Fixture desk lamp', 'Fixture studio flat', 'Fixture city scooter', 'Fixture bicycle']

test.describe('marketplace, against known fixtures', () => {
  test('the home feed renders every fixture listing', async ({ page }) => {
    await page.goto('/')
    for (const title of FIXTURES) {
      await expect(page.getByText(title, { exact: false }).first(), `"${title}" should be in the feed`).toBeVisible()
    }
  })

  // ⛔ THE LICENSING CONTROL, ASSERTED IN A BROWSER. eno.vn is a licensed marketplace and may not
  // surface the visa/trip desk; `scopedListingWhere` excludes it, and a runtime bypass of exactly
  // that filter is what leaked 14 e-visa listings into ?q=visa on 2026-09-01. Unit tests cover the
  // predicate; only a rendered page covers the path from request to HTML.
  test('the desk listing never reaches the marketplace, by feed or by search', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Fixture e-visa')).toHaveCount(0)
    await page.goto('/?q=visa')
    await expect(page.getByText('Fixture e-visa')).toHaveCount(0)
  })

  // ⛔ THE ROUTES THEMSELVES, NOT ONLY THE ROW. A reviewer was right that asserting one listing
  // title is absent proves very little about a LEGAL boundary: the licensed marketplace must not
  // serve the visa or itinerary surfaces at all. They are `.svc.` files excluded from this
  // edition's `pageExtensions`, so on this build they do not exist — and "the build that ships is
  // the one that decides" is exactly what a browser can check and a unit test cannot.
  test('the licensed edition does not serve the visa or itinerary surfaces', async ({ page }) => {
    for (const path of ['/visa', '/itinerary']) {
      const res = await page.goto(path)
      expect(res?.status(), `${path} must not exist on the marketplace edition`).toBe(404)
    }
  })

  /**
   * ⛔ A MISSING PAGE MUST ANSWER 404, NOT 200 — AND THIS ROUTE HAS FAILED THAT TWICE, EACH TIME
   * WITH A COMMENT IN THE CODE ASSERTING THE OPPOSITE. `listings/[id]/page.tsx` said its
   * `notFound()` in generateMetadata made "a REAL 404 instead of a soft-404"; production answered
   * 200. `c/[category]/page.tsx` was then corrected to say the soft-404 was unavoidable and should
   * be left alone. Both statements were prose, and prose is exactly what rotted — so the invariant
   * now lives in a test that fetches the route and reads the status byte.
   *
   * ⚠️ IT IS THE STATUS THAT IS ASSERTED, NEVER THE BODY. Both routes rendered the correct
   * not-found UI the whole time they were broken, and the RSC payload even carried
   * NEXT_HTTP_ERROR_FALLBACK;404 — Next threw correctly and only the status had already gone out
   * as 200. Any check that looked at what the page SAID would have passed throughout.
   *
   * The cause was each segment's own `loading.tsx`: a loading boundary makes Next flush the shell,
   * status included, before the page's notFound() runs. The fix is a `layout.tsx` guard, which
   * nests ABOVE that boundary. If someone deletes those layouts, this test is what says so.
   */
  test('an unknown listing or category is a real 404, not a soft one', async ({ page }) => {
    for (const path of [
      '/listings/no-such-listing-e2e',
      '/listings/00000000-0000-0000-0000-000000000000',
      '/c/no-such-category-e2e',
      // The district page's own 404 — real only while no loading.tsx sits above [district]
      // (district-status-contract.test.ts pins the file layout; this reads the status byte).
      '/c/electronics/no-such-district-e2e',
    ]) {
      const res = await page.goto(path)
      expect(res?.status(), `${path} must answer a real 404, not a 200 carrying the not-found UI`).toBe(404)
    }
  })

  /**
   * ⛔ ONE URL PER PLACE: a spelling that is not the canonical slug is a real 308 to it, not a 200
   * twin and not a client-side redirect inside a 200 (which a loading.tsx above [district] would
   * make it). Case is the spelling the fixture can exercise: `Thao-Dien-Fixture` slugifies to the
   * fixture's own `thao-dien-fixture`. Not followed, so the status byte is what is asserted — the
   * CI server is one origin on :3100, so there is no www/apex hop to trip over.
   */
  test('a non-canonical district spelling is a real 308 to the canonical URL', async ({ page }) => {
    const res = await page.request.get('/c/electronics/Thao-Dien-Fixture', { maxRedirects: 0, failOnStatusCode: false })
    expect(res.status()).toBe(308)
    expect(res.headers()['location'] ?? '').toMatch(/\/c\/electronics\/thao-dien-fixture$/)
  })

  /**
   * ⛔ THE 404 GUARD IS THE PRODUCT PAGE'S, NOT THE OWNER'S. It lived at `listings/[id]/layout.tsx`,
   * where a layout wraps every child segment — so `edit/` inherited the public viewability rule and
   * a seller got a 404 editing a hidden, pending or held listing. It now sits in the `(pdp)` route
   * group. This suite has no signed-in seller, so it asserts the half it can see: the public page
   * still 404s, and the edit URL answers with the owner flow (sign in first), not the public 404.
   */
  test('a hidden listing is a 404 to the public, but its edit screen still reaches the owner flow', async ({ page }) => {
    const res = await page.goto('/listings/ci-l-hidden')
    expect(res?.status(), 'a hidden listing must answer a real 404').toBe(404)
    const edit = await page.goto('/listings/ci-l-hidden/edit')
    expect(edit?.status(), 'the edit URL must not inherit the public page\'s 404').not.toBe(404)
    await expect(page).toHaveURL(/\/signin\?next=%2Flistings%2Fci-l-hidden%2Fedit|\/signin\?next=\/listings\/ci-l-hidden\/edit/)
    // …and the fixture itself must never surface publicly. `?q=Fixture` matches its title too, so a
    // leak through search is a visible card; a public fixture rendering first proves the list loaded.
    for (const path of ['/', '/?q=Fixture']) {
      await page.goto(path)
      await expect(page.getByText('Fixture laptop').filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByText('Fixture hidden listing'), `${path} must not show a hidden listing`).toHaveCount(0)
    }
  })

  test('a category page shows its own fixtures and no others', async ({ page }) => {
    await page.goto('/c/vehicles')
    await expect(page.getByText('Fixture city scooter').first()).toBeVisible()
    await expect(page.getByText('Fixture bicycle').first()).toBeVisible()
    await expect(page.getByText('Fixture desk lamp')).toHaveCount(0)
  })

  test('search finds a fixture by title', async ({ page }) => {
    await page.goto('/?q=bicycle')
    await expect(page.getByText('Fixture bicycle').first()).toBeVisible()
  })

  // ⛔ AUDIT #3, REPRODUCED LIVE ON /c/rentals: the header sent search, map, brand and area picks
  // to the explorer as window events on every /c/* page, but those pages never mount it — Enter did
  // nothing and no request left the page. This asserts the destination, which is the same whether
  // the header has hydrated (explorerFallbackUrl) or not (the form's native GET + hidden category).
  test('the header search on a category landing page searches — inside that category', async ({ page }) => {
    await page.goto('/c/vehicles')
    // The header's search landmark → its combobox named "Search" (the input owns the suggestion list,
    // so it is a combobox: getByRole('searchbox') found nothing on this test's first CI run). Visible
    // only, and the accessible name stays asserted.
    const box = page.getByRole('search').getByRole('combobox', { name: 'Search' }).filter({ visible: true }).first()
    await box.fill('bicycle')
    await box.press('Enter')
    await expect(page).toHaveURL(/\/\?(?=.*\bcategory=vehicles\b)(?=.*\bq=bicycle\b)/)
    await expect(page.getByText('Fixture bicycle').first()).toBeVisible()
  })

  // ⛔ THE RACE THE TEST ABOVE HIT BY CHANCE (CI, 2026-09-27), MADE DETERMINISTIC. Typed before
  // hydration, submitted after: a re-render wrote `searchVal` ('') over the field and the search went
  // out empty (header.tsx explains the two halves of the fix). Only the JS chunks are held — Turbopack
  // serves CSS from the same folder and a held stylesheet blocks the parser, so domcontentloaded would
  // never fire. No networkidle either (a wedged /_next/image variant once kept it from ever arriving —
  // see the image tests at the end of this file), so the wait is on the root CurrencyProvider's mount
  // fetch (/api/fx) — passive effects run child-first, so by then the header's mount effects, and any
  // re-render they caused, ran.
  test('text typed before the header hydrates survives hydration and is searched', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, async (route) => { await held; await route.continue() })
    await page.goto('/c/vehicles', { waitUntil: 'domcontentloaded' })
    await streamed(page)
    const box = page.getByRole('search').getByRole('combobox', { name: 'Search' }).filter({ visible: true }).first()
    await box.fill('bicycle')
    const fx = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/fx')
    release()
    await page.waitForFunction(() => {
      const form = document.querySelector('form[role="search"]')
      return !!form && Object.keys(form).some((k) => k.startsWith('__reactFiber'))
    })
    await fx
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await expect(box).toHaveValue('bicycle')
    await box.press('Enter')
    await expect(page).toHaveURL(/\/\?(?=.*\bcategory=vehicles\b)(?=.*\bq=bicycle\b)/)
  })

  // The same race on a page whose URL already carries a query: the server renders the box EMPTY, so
  // what is in it at hydration was typed — it must win over the URL's own ?q=, or refining a search
  // on a slow phone silently searches the old term again.
  test('text typed before hydration also beats the URL query it is refining', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, async (route) => { await held; await route.continue() })
    await page.goto('/c/vehicles?q=scooter', { waitUntil: 'domcontentloaded' })
    await streamed(page)
    const box = page.getByRole('search').getByRole('combobox', { name: 'Search' }).filter({ visible: true }).first()
    await box.fill('bicycle')
    const fx = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/fx')
    release()
    await page.waitForFunction(() => {
      const form = document.querySelector('form[role="search"]')
      return !!form && Object.keys(form).some((k) => k.startsWith('__reactFiber'))
    })
    await fx
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await expect(box).toHaveValue('bicycle')
  })

  // ⚠️ THE OWNER REPORTED THIS TWICE ("the text overlaps"), AND A UNIT TEST CANNOT SEE IT: the
  // price is an inline run, so its own scrollWidth/clientWidth are 0 — only its rect against the
  // CARD's rect shows the spill. Measured on prod before the fix: 8 of 8 service cards overflowed
  // by 24–77px at 320–430px wide. This asserts the geometry, at the width where it was worst.

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // FULL-CATALOGUE SCOPE (review finding 10). The fixtures seed 700 listings for one seller, the
  // lowest-ranked 50 of them in one district, and the cheapest row of all is last by rank and
  // oldest by date. Every assertion below is "can this surface reach a record that is off its own
  // first page" — which is exactly what an in-browser sort over a fetched window cannot do.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  test('a storefront sorts its whole shop, not the page it rendered', async ({ page }) => {
    await page.goto('/sellers/ci-bulk-store')
    await ready(page)
    // The heading states the true inventory; the grid is a page of it.
    await expect(page.getByRole('heading', { name: /CI Bulk Warehouse \(700\)/ })).toBeVisible()
    // ⛔ THE CHEAPEST ROW IS NOT ON THIS PAGE. It is the oldest of 700, so no amount of reordering
    // the 60 newest can produce it.
    await expect(page.getByText('Bulk bargain 000')).toHaveCount(0)
    await page.getByRole('tab', { name: /price/i }).click()
    await expect(page.getByText('Bulk bargain 000').first()).toBeVisible()
  })

  test('a storefront searches its whole shop', async ({ page }) => {
    await page.goto('/sellers/ci-bulk-store')
    await ready(page)
    await page.getByLabel('Search this seller').fill('Bulk bargain')
    await expect(page.getByText('Bulk bargain 000').first()).toBeVisible()
  })

  test('a storefront pages beyond its first screen', async ({ page }) => {
    await page.goto('/sellers/ci-bulk-store')
    await ready(page)
    await expect(page.locator('[data-card-root]').first()).toBeVisible()
    const before = await page.locator('[data-card-root]').count()
    expect(before).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Show more' }).click()
    // The next page is a network round trip; poll rather than assert on the next tick.
    await expect
      .poll(async () => page.locator('[data-card-root]').count(), { timeout: 15_000 })
      .toBeGreaterThan(before)
  })

  // ⛔ THE FALSE 404. This district's 50 listings are positions 651-700 of their category, so the
  // page's old 600-row scan found none of them and answered 404 for a place that exists.
  test('a district page exists even when its listings rank below any scan cap', async ({ page }) => {
    await page.goto('/c/electronics/thao-dien-fixture')
    // ⚠️ ASSERT THE PAGE, NOT THE STATUS CODE. Measured on the pre-fix build: this URL served the
    // "Page not found" body with **HTTP 200** and `x-nextjs-prerender: 1` — `notFound()` on an ISR
    // route is prerendered and cached, so a status assertion passes on the broken build. The
    // heading is what tells a real district page from a soft 404.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Thao Dien Fixture')
    await expect(page).not.toHaveTitle(/Page not found/)
  })

  test('a district page counts the district, not the window it fetched', async ({ page }) => {
    await page.goto('/c/electronics/thao-dien-fixture')
    // ⚠️ VISIBLE ONLY. While the streamed page swaps in, React keeps a HIDDEN copy of this paragraph in
    // the DOM, so a bare text locator sometimes resolves two elements and fails strict mode — the
    // intermittent failure this test has had for weeks (CI log: "resolved to 2 elements … hidden").
    // A regex, not a substring: "150 electronics listings…" must NOT pass for 50.
    await expect(page.getByText(/(^|[^0-9])50 electronics listings in Thao Dien Fixture/).filter({ visible: true }).first()).toBeVisible()
  })

  test('a district sort reaches the cheapest listing in the district', async ({ page }) => {
    await page.goto('/c/electronics/thao-dien-fixture')
    await ready(page)
    await page.getByRole('tab', { name: /price/i }).click()
    await expect(page.getByText('Bulk bargain 000').first()).toBeVisible()
  })

  // ⛔ A CATEGORY SORT USED TO LEAVE THE PAGE (C1-DEADEND, 2026-09-29): the strip was links into the
  // explorer at a URL canonicalised to /. It is a scoped query in place now, so the cheapest row in
  // the category — last by rank, off the first page — is reachable without the pathname changing.
  test('a category sort reaches the cheapest listing in the category', async ({ page }) => {
    await page.goto('/c/electronics')
    await ready(page)
    await expect(page.getByText('Bulk bargain 000')).toHaveCount(0)
    await page.getByRole('tab', { name: /price/i }).click()
    await expect(page.getByText('Bulk bargain 000').first()).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/c/electronics')
  })

  // ⛔ THE FIRST PAGE AND THE API MUST BE ONE SEQUENCE. The page used to render plain rank order while
  // Show-more asked the API, which interleaves by seller — so page 2 continued a DIFFERENT list, rows
  // repeated (and were deduped away) and rows never appeared. The Bulk Warehouse owns 700 of these
  // rows, which is exactly the shape the seller interleave reorders.
  test('Show more on /c/electronics continues without repeats', async ({ page }) => {
    await page.goto('/c/electronics')
    await ready(page)
    const cards = page.locator('[data-card-root]')
    await expect(cards.first()).toBeVisible()
    // Scoped to the grid: on a phone the lede has its own "Show more" (clamped-lede.tsx).
    await page.locator('[data-listings-ready="true"]').getByRole('button', { name: 'Show more' }).click()
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(96)
    const hrefs = await page.locator('[data-card-root] a[href^="/listings/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    expect(new Set(hrefs).size).toBe(96)
  })

  // ⛔ THE DISTRICT USED TO BE DROPPED ON THE WAY OUT. "Refine in full search" linked to
  // `/?category=<slug>`, so one click after choosing a district the reader was in the whole
  // category — and the API could not have honoured the district anyway, because this slug is not
  // one of the curated DISTRICTS keys.
  test('leaving a district page for the full search keeps the district', async ({ page }) => {
    await page.goto('/c/electronics/thao-dien-fixture')
    await page.getByRole('link', { name: /Refine in full search/ }).click()
    await expect(page).toHaveURL(/district=thao-dien-fixture/)
    // ⚠️ ANCHOR ON A CARD FIRST. `toHaveCount(0)` is trivially true while the feed is still
    // fetching, so on its own this assertion passes against a build that never filtered at all
    // (external review). Wait for the district's own rows, THEN assert the sibling ward's are absent.
    await expect(page.locator('[data-card-root]').first()).toBeVisible()
    await expect(page.getByText('Bulk item 100')).toHaveCount(0)
  })

  test('an unresolvable district returns nothing rather than the whole catalogue', async ({ page }) => {
    // ⚠️ `?district=junk` used to be read as "no district filter" and returned everything.
    // Anchored the same way: prove the feed has finished by seeing it settle on a zero-results
    // state, so an empty page cannot pass for a filtered one.
    await page.goto('/?district=not-a-real-place')
    await expect(page.locator('[data-card-root]')).toHaveCount(0)
    await expect(page.getByText(/No listings|Không có tin/i).first()).toBeVisible()
    await expect(page.getByText('Bulk item')).toHaveCount(0)
  })

  test('no price spills out of its card on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.waitForTimeout(500)
    // ⛔ A COUNT FIRST, OR THIS TEST PASSES ON AN EMPTY PAGE. "No price overflowed" is trivially
    // true when nothing rendered — and a stale server serving a build with no fixtures is exactly
    // the state that produced a green run during development.
    await expect(page.locator('[data-card-root]').first()).toBeVisible()
    expect(await page.locator('[data-card-root]').count()).toBeGreaterThanOrEqual(6)
    const spills = await page.evaluate(() => {
      const out: string[] = []
      for (const card of document.querySelectorAll('[data-card-root]')) {
        const cr = card.getBoundingClientRect()
        for (const el of card.querySelectorAll('span.tabular-nums, span.tabular-nums span')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0) continue
          if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) out.push(`${(el.textContent || '').trim()} +${Math.round(r.right - cr.right)}px`)
        }
      }
      return out
    })
    expect(spills, 'price runs must stay inside their card').toEqual([])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ⛔ ONE DROPPED IMAGE REQUEST FAILED 13 OF 20 TESTS IN A SINGLE CI RUN (2026-09-27). For a LOCAL
  // source, Next 16.3.x's optimizer reads the file through a fake response bound to the CLIENT's
  // socket and awaits it with no timeout; when the browser has already dropped that request, the
  // static file server sees a dead socket, never ends the fake response, and the per-variant dedupe
  // entry never settles. Every later request for that variant (url × w × q × Accept) hangs until
  // the server restarts — and so does `load` on every page that shows it. The fixture photo is a
  // local SVG, so every card on `/` shared one wedged variant. Fixed in the PRODUCT, twice over:
  // src/lib/image-loader.ts serves local image files as themselves and `images.localPatterns` admits
  // only /listing-images, so the optimizer refuses a public/ file before it reads one; and
  // scripts/patch-next-image-optimizer.mjs (run by `npm run build`) fixes the read itself, which is
  // what protects the /_next/static/media/** files Next admits on its own.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  test('a card photo that is a local file loads as that file, not through the optimizer', async ({ page }) => {
    await page.goto('/')
    // The fixture photo (scripts/ci-fixtures.ts `IMAGE`). A positive check first, so a page whose
    // cards fell back to their placeholder cannot pass the absence check below. Re-queried on every
    // poll: the feed re-renders its cards after hydration, so a held element handle goes stale.
    await expect.poll(() => page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('[data-card-root] img[src*="camera.svg"]')
      if (!img) return 'no fixture photo on the page'
      img.scrollIntoView({ block: 'center' }) // the card photo is lazy — bring it into range
      return img.complete && img.naturalWidth > 0 ? 'loaded' : `not loaded: ${img.currentSrc || img.src}`
    }), { message: 'the fixture photo must actually load' }).toBe('loaded')
    const viaOptimizer = await page.evaluate(() => {
      const urls: string[] = []
      const add = (one: string | null, set: string | null) => {
        if (one) urls.push(one)
        for (const c of (set ?? '').split(',')) if (c.trim()) urls.push(c.trim().split(/\s+/)[0])
      }
      for (const el of document.querySelectorAll('img')) add(el.getAttribute('src'), el.getAttribute('srcset'))
      for (const el of document.querySelectorAll('link[rel="preload"][as="image"]')) add(el.getAttribute('href'), el.getAttribute('imagesrcset'))
      return urls.filter((u) => {
        const x = new URL(u, location.href)
        const inner = x.pathname === '/_next/image' ? x.searchParams.get('url') ?? '' : ''
        return inner.startsWith('/') && !inner.startsWith('/listing-images?')
      })
    })
    expect(viaOptimizer, 'a local file routed through /_next/image').toEqual([])
  })

  test('a dropped request for a local file cannot wedge the optimizer: it is refused before any read', async ({ request, baseURL }) => {
    const { widths, quality } = optimizerParams()
    const variants = accepts.flatMap((accept) => widths.flatMap((w) =>
      ['/icons/ui/rest/camera.svg', '/icon-192.png', '/icon-192.png?v=2b609517'].map((src) =>
        ({ path: `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${quality}`, accept }))))
    await dropAll(baseURL!, variants)
    // Before the fix each of these hung forever. A short timeout is the assertion: an answer, now —
    // and the REASON, so a 400 from anything else (a width or quality the config does not list, an
    // SVG refused after it was read) cannot pass for the refusal that happens before any read.
    for (const { path, accept } of variants) {
      const res = await request.get(path, { headers: { accept }, timeout: 5_000, failOnStatusCode: false })
      expect({ status: res.status(), body: await res.text() }, `${path} (${accept}) — the optimizer must never read a local file`)
        .toEqual({ status: 400, body: '"url" parameter is not allowed' })
    }
  })

  test('a dropped request for a build asset the optimizer DOES read still gets its answer (Next patched)', async ({ request, baseURL }) => {
    // Next appends /_next/static/media/** to images.localPatterns itself, so these ARE read — through
    // the same code that wedged. The fonts are the files the page itself names; a font is read in
    // full and then refused as "not a valid image", which is exactly the read-then-answer path.
    const html = await (await request.get('/')).text()
    const media = [...new Set(html.match(/\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2/g) ?? [])]
    expect(media.length, 'the home page no longer names a /_next/static/media font to probe with').toBeGreaterThan(0)
    const { widths, quality } = optimizerParams()
    const variants = accepts.flatMap((accept) => widths.flatMap((w) =>
      media.map((src) => ({ path: `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${quality}`, accept }))))
    await dropAll(baseURL!, variants)
    // Unpatched (16.3.x as shipped), a dropped read of these never settles and these requests hang.
    for (const { path, accept } of variants) {
      const res = await request.get(path, { headers: { accept }, timeout: 5_000, failOnStatusCode: false })
      expect({ status: res.status(), body: await res.text() }, `${path} (${accept}) — read, then answered`)
        .toEqual({ status: 400, body: "The requested resource isn't a valid image." })
    }
  })
})

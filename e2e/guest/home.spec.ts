import { test, expect } from '../helpers'

// Guest homepage — loads and exposes its core surfaces. `test` (from ../helpers) pre-seeds the
// privacy-preserving consent choice so the first-visit modal never blocks interaction.
test.describe('Guest · homepage', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('loads with title and hero', async ({ page, baseURL }) => {
    /**
     * ⚠️ THE BRAND IN THE TITLE IS THE EDITION'S, NOT A CONSTANT, AND IT IS READ FROM THE PAGE.
     * This asserted /eno\.vn/i and so failed against eno.forum — the SAME codebase deployed as the
     * services edition. Deriving it from `page.url()` instead was worse: it made the spec
     * impossible to pass on the one target the ship ritual actually points it at (a local preview
     * serves the marketplace bundle on `localhost`, so the expectation became /localhost/i against
     * "eno.vn - Trusted Expat Marketplace in Vietnam") and it broke on any subdomain too. The
     * canonical link is the edition's own declared identity, so it is right on eno.vn, on
     * eno.forum, and on any host either bundle happens to be served from.
     *
     * ⛔ AND THIS SPEC DOES NOT CARRY THE LICENSING CHECK. All four reviewers made the same point:
     * a page agreeing with itself proves nothing about WHICH edition was deployed — a services
     * bundle served by mistake on eno.vn would declare eno.forum and pass here. That check is real
     * and lives where it can actually be made, at the SOURCE level rather than over HTTP:
     * `scripts/edition-lint.mjs` runs in both `npm run build` and `npm run lint` and fails the
     * build if the marketplace tree can reach the visa/itinerary modules at all, and
     * `e2e/visa-authed.spec.ts` asserts the storefront 404s on the edition that must not serve it.
     * An earlier version of this comment credited an `e2e/fixtures` gate; there is no such gate —
     * that directory holds three JPEGs. All this spec honestly owns is "the homepage loaded, titled
     * as one of our two editions, with a hero".
     */
    const canonical = await page
      .locator('link[rel=canonical]')
      .first()
      .getAttribute('href', { timeout: 5000 })
      .catch(() => null)
    // A relative canonical must not throw — `new URL('/')` with no base is a TypeError, which would
    // crash the runner instead of failing an assertion.
    const declared = canonical
      ? (() => { try { return new URL(canonical, page.url()).hostname.replace(/^www\./, '') } catch { return null } })()
      : null
    // `expect(...).toContain` does not narrow, so assert on a local the compiler can follow.
    if (declared !== 'eno.vn' && declared !== 'eno.forum') {
      throw new Error(`page declared canonical host ${declared ?? '(none)'}, expected eno.vn or eno.forum`)
    }
    /**
     * ✅ AND ON A PRODUCTION HOST THE EXPECTATION IS INDEPENDENT OF THE PAGE. This is the half the
     * canonical alone cannot supply, and all four reviewers asked for it twice: a services bundle
     * misrouted onto eno.vn declares eno.forum and would otherwise agree with itself all the way
     * through. The request host is the one fact the page does not get to author, so when we are
     * pointed at an edition's own domain, the bundle it serves must be THAT edition's.
     * ⚠️ THE EXCEPTION IS DELIBERATE AND NARROW. A preview or staging host is not an edition
     * domain and cannot be held to one, which is the failure that started this whole rewrite; those
     * targets keep the weaker "one of our two editions" check above and nothing more.
     */
    /**
     * ⛔ THE TARGET IS THE CONFIGURED baseURL, NOT `page.url()` — A REDIRECT MUST NOT MOVE THE
     * GOALPOST. `beforeEach` does `goto('/')`, so by the time we read `page.url()` a 301 has already
     * rewritten it: point the suite at eno.vn, let eno.vn redirect to eno.forum, and host, canonical
     * and title would all agree on eno.forum while a buyer who typed the licensed marketplace domain
     * lands on the visa/itinerary edition. `baseURL` comes from playwright.config.ts (E2E_BASE) and
     * the page cannot touch it. No `?? page.url()` fallback: that quietly restores the very hole
     * this closes, and the config already throws when E2E_BASE is unset, so a missing baseURL is a
     * broken harness and must say so rather than silently weaken the assertion.
     */
    if (!baseURL) throw new Error('no baseURL — the edition assertion below cannot be trusted without one')
    const host = new URL(baseURL).hostname.replace(/^www\./, '')
    if (host === 'eno.vn' || host === 'eno.forum') {
      expect(declared, `${host} must declare itself as ${host}`).toBe(host)
      /**
       * ⛔ AND THE CANONICAL IS NOT PROOF OF THE EDITION, WHICH IS WHY THIS SECOND CHECK EXISTS.
       * A canonical is baked from NEXT_PUBLIC_APP_URL, so a SERVICES container misrouted behind
       * eno.vn but built with the marketplace's APP_URL declares eno.vn and satisfies the line
       * above. Three reviewers made that point across three rounds and they are right: the env var
       * is not the edition flag. `/itinerary` is, and it is guest-visible — measured today, 404 on
       * eno.vn and 200 on eno.forum. This asks the deployment which BUNDLE it is running, which is
       * the only thing the page cannot lie about.
       * ⚠️ `/visa` IS NOT A DISCRIMINATOR — it 404s on BOTH editions (the visa desk lives under
       * other routes, and eno.vn deliberately keeps the partner visa slot). Do not swap it in.
       */
      /**
       * ⚠️ FOLLOW REDIRECTS ON THIS PROBE — `maxRedirects: 0` MADE IT WRONG ON A REAL TARGET.
       * Measured: https://www.eno.vn/itinerary answers 308 to the apex, so a suite pointed at the
       * www host failed the 404 expectation on a perfectly healthy deployment. Following is also
       * the STRICTER reading, not a relaxation: if eno.vn ever redirected to the services edition,
       * this lands on its 200 and fails, which is precisely the misroute we are hunting.
       */
      /**
       * ⚠️ AND WHERE THE BROWSER ACTUALLY LANDED, because the probe below asks the CONFIGURED base
       * — so a `/` that redirects eno.vn onto a services deployment would leave the browser on the
       * wrong edition while eno.vn's own /itinerary still answers 404 and every other assertion
       * passes. Comparing www-stripped hosts keeps the legitimate www-to-apex normalization legal.
       */
      expect(new URL(page.url()).hostname.replace(/^www\./, ''), 'navigation left the edition domain')
        .toBe(host)
      const itinerary = await page.request.get('/itinerary', { failOnStatusCode: false })
      expect(itinerary.status(), `${host} served /itinerary ${itinerary.status()} — wrong edition bundle`)
        .toBe(host === 'eno.forum' ? 200 : 404)
    }
    await expect(page).toHaveTitle(new RegExp(declared.replace(/\./g, '\\.'), 'i'))
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('shows the search box and primary CTAs', async ({ page }) => {
    // ⚠️ THE SEARCH BOX IS THE HEADER'S NOW (owner, 2026-08-03: "move main searchbar to top navbar").
    // The hero bar that carried `hero.searchPlaceholder` ("Search motorbikes, apartments…") was
    // deleted, so that string is no longer on any page — matching it here failed against a homepage
    // that was working perfectly. `:visible` + .first() because the header renders a mobile and a
    // desktop input and BOTH are in the DOM; a bare locator trips Playwright's strict mode.
    await expect(page.locator('input[placeholder*="Find products"]:visible').first()).toBeVisible()
    // Post + Sign-in routes are wired; on desktop they're in the header, on mobile the bottom
    // nav. Assert a VISIBLE Post affordance (viewport-agnostic) and that a Sign-in link exists.
    await expect(page.locator('a[href="/post"]:visible').first()).toBeVisible()
    await expect(page.locator('a[href="/signin"]').first()).toBeAttached()
  })

  test('renders category navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Electronics/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Vehicles/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Property/ })).toBeVisible()
  })

  test('shows home rails', async ({ page }) => {
    // ⚠️ "Latest listings" is an always-rendered sr-only <h2> (listings-explorer.tsx:1704),
    // so heading-only assertions passed with EVERY rail removed — proven by deleting them
    // and watching this test stay green. A rail is its CARDS; assert those.
    const trending = page.getByRole('heading', { name: /Trending now/i })
    const latest = page.getByRole('heading', { name: /Latest listings/i })
    await expect(trending.or(latest).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
  })

  test('content images decode (no broken cards)', async ({ page }) => {
    // Wait for a card to render, then measure the largest VISIBLE image — a broken image
    // reports naturalWidth === 0 even though the <img> exists.
    await expect(page.getByRole('button', { name: 'Save listing' }).first()).toBeVisible()
    const naturalWidth = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 60 && r.height > 60 })
      if (!vis.length) return -1
      const big = vis.reduce((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height > ar.width * ar.height ? b : a })
      return big.naturalWidth
    })
    expect(naturalWidth, 'largest visible image should have decoded').toBeGreaterThan(0)
  })
})

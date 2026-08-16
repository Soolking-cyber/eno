import { test, expect } from '../helpers'

// Listing detail as a logged-out guest. READ-ONLY: we may click the contact gate /
// carousel arrow to assert behaviour, but never log in or mutate anything.
//
// The target listing is resolved LIVE from the home feed (audit Phase 0): the old
// hardcoded cuid died on every reseed/wipe, silently skipping the whole suite's
// subject. First card wins; its accessible name is the listing title.
let LISTING = ''
let TITLE_RE = /./

test.describe('Guest · listing detail (first live listing)', () => {
  test.beforeEach(async ({ page }) => {
    if (!LISTING) {
      await page.goto('/')
      const card = page.locator('a[data-card-link]').first()
      await card.waitFor({ timeout: 20_000 })
      LISTING = new URL((await card.getAttribute('href'))!, page.url()).pathname
      const label = (await card.getAttribute('aria-label')) || (await card.textContent()) || ''
      // Escape each word FIRST, then join with \s+ — escaping after joining would
      // mangle the joiner's own `+` into a literal.
      const words = label.trim().split(/\s+/).slice(0, 3)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+')
      TITLE_RE = new RegExp(words, 'i')
    }
    await page.goto(LISTING)
  })

  test('shows title and price area', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE_RE })).toBeVisible()
    await expect(page).toHaveTitle(TITLE_RE)
  })

  test('main image actually renders (broken-image guard)', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE_RE })).toBeVisible()
    // Largest visible <img> = the hero photo; a broken image reports naturalWidth === 0.
    const naturalWidth = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 80 && r.height > 80 })
      if (!vis.length) return 0
      const big = vis.reduce((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height > ar.width * ar.height ? b : a })
      return big.naturalWidth
    })
    expect(naturalWidth, 'main listing image should have decoded (naturalWidth > 0)').toBeGreaterThan(0)
  })

  test('opens the photo lightbox and locks background scroll', async ({ page }) => {
    // Desktop opens the lightbox via "View all photos · N" on the mosaic; mobile's
    // full-width swipe carousel opens it by tapping the photo itself. Either way it
    // must open a modal that FREEZES the page behind it so swipes don't scroll the
    // background.
    //
    // ⛔ THIS TEST PICKS ITS OWN LISTING, AND THAT IS THE FIX FOR WHY IT WENT RED. The suite's
    // shared `LISTING` is simply the FIRST card on the home feed, and the feed's first card is now
    // a partner SERVICE (an e-Visa product, and since 2026-08-16 the free trip-planning listing)
    // which carries ONE photo. A single-photo gallery correctly offers no lightbox, so the test
    // was failing on a listing that had nothing to open — a fixture problem wearing the costume of
    // a product bug. It had been red on production for days behind a truncated log.
    //
    // ⚠️ It still FAILS if no listing on the first screen has a gallery: the affordance is what is
    // under test, so "found none" must be a failure and never a silent skip.
    await page.goto('/')
    const cards = page.locator('a[data-card-link]')
    await cards.first().waitFor({ timeout: 20_000 })
    // Absolute app paths already ("/listings/…"), so they are used as-is — resolving each against
    // `page.url()` while that url CHANGES inside the loop is a trap a reviewer rightly flagged,
    // even though same-origin absolute paths happen to survive it.
    const hrefs = (await cards.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href'))))
      .filter((h): h is string => !!h && h.startsWith('/listings/'))
      .slice(0, 8)
    expect(hrefs.length, 'no listing cards on the home feed to test a gallery with').toBeGreaterThan(0)
    let opened = false
    for (const href of hrefs) {
      await page.goto(href)
      const viewAllHere = page.getByRole('button', { name: /View all photos/i })
      const photoHere = page.getByRole('button', { name: /photo 1/i }).first()
      if (await viewAllHere.isVisible().catch(() => false)) { await viewAllHere.click(); opened = true; break }
      if (await photoHere.isVisible().catch(() => false)) { await photoHere.click(); opened = true; break }
    }
    expect(opened, 'no listing on the first screen offered a gallery to open — every one is single-photo?').toBe(true)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Background is scroll-locked while open…
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    // …and restored on close.
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('contact is gated for guests', async ({ page }) => {
    // The sign-in gate lives IN the click handler rather than in the button copy. A guest who taps
    // the contact CTA must get the sign-in dialog — never a live thread / the seller's contact.
    //
    // ⛔ THE CTA'S COPY IS PRODUCT-DEPENDENT NOW, WHICH IS WHY /^(Chat now|Chat)$/ WENT RED ON
    // PRODUCTION. This spec opens the FIRST live listing, and the top of the feed is now a licensed
    // partner's service: an e-Visa product renders <VisaStart> ("Apply in chat") and the trip desk
    // renders <ContactComposer intent="plan"> ("Plan my trip in chat"). Neither is "Chat now", so
    // the locator found nothing on a page where the gate was working perfectly well.
    //
    // ⚠️ AND THOSE SURFACES ON eno.vn ARE INTENDED, NOT A LEAK — stated here because all three
    // reviewers read this list as a test quietly blessing one. eno.vn does not SELL visa or
    // itinerary services; it hosts the chat for LICENSED PARTNERS who do (VietKite, owner
    // 2026-08-13 "intended, do it same as eno.forum for Vietkite"; GMBR, owner 2026-08-16). Their
    // products are ordinary Listing rows on their own storefronts. What would be a leak is eno.vn
    // offering them in its OWN voice — the footer links, the desk tiles and the SEO pages — and
    // that is enforced by the resolveAlias block in next.config.ts, not by this file.
    //
    // ⚠️ NAMED IN FULL RATHER THAN LOOSENED TO /chat/i. A substring match would also catch
    // "Opening chat…" — the BUSY label of this very button — and a test that passes on a spinner
    // is how a broken gate ships. Each entry is a real CTA; add one when a new product adds one.
    const chat = page.getByRole('button', { name: /^(Chat now|Chat|Apply in chat|Plan my trip in chat)$/i }).first()
    await expect(chat).toBeVisible()
    const dialog = page.getByRole('dialog')
    // A click that lands while useAuth is still resolving is buffered by ContactComposer
    // and drained once auth settles — so a single click always yields the sign-in dialog.
    await chat.click()
    await expect(dialog).toBeVisible({ timeout: 15000 })
  })

  test('exposes Save / Share / Report controls', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Share$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible()
  })
})

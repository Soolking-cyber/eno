import { test, expect } from '../helpers'
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The two shapes a listing's buy box can take, named once so the branch and the dedicated
// partner spec below cannot drift apart.
const CHAT_CTA = /^(Chat now|Chat|Apply in chat|Plan my trip in chat)$/i
const BOOK_CTA = /^Book on /
// ⚠️ THE HOOK, NOT THE COPY, IDENTIFIES THE OUTBOUND CTA. `/^Book on /` matched page-wide would
// also match a similar-listings card titled "Book on …", diverting a healthy ordinary PDP into
// the partner assertions. `data-affiliate-cta` is on exactly one anchor: the booking link.
const BOOK_LINK = '[data-affiliate-cta]'

// ONE SOURCE OF TRUTH for who the affiliate partner is and where its links may point: the
// catalogue the seeder reads. Literals here would drift the day a second partner is added and
// nobody thinks to look in a spec file.
//
// ⚠️ `__dirname`, NOT `import.meta.url` — Playwright loads specs as CommonJS, so import.meta is a
// SyntaxError here that surfaces as the unhelpful "No tests found".
// ⚠️ FAIL SOFT. This runs at COLLECTION time: a checkout without the catalogue (or with a
// different shape) would otherwise throw while the file is being loaded and take every unrelated
// guest spec in it down with a stack trace that names none of them.
const CATALOGUE: { partner?: { name?: string }; destinations?: { affiliateUrl?: string }[] } = (() => {
  try {
    return JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'data', 'vinwonders-destinations.json'), 'utf8'),
    )
  } catch {
    return {}
  }
})()
const PARTNER = CATALOGUE.partner?.name || ''
const PARTNER_HOSTS = [
  ...new Set(
    (CATALOGUE.destinations || [])
      .map((d) => {
        try {
          return new URL(d.affiliateUrl || '').hostname
        } catch {
          return ''
        }
      })
      .filter(Boolean),
  ),
]

// The contract a partner-affiliate listing owes a guest. Called from the category spec below,
// which is the deterministic way in; the chat-gate spec above walks PAST partner listings rather
// than asserting here, so each contract has exactly one owner and neither rides on feed order.
async function assertPartnerBooking(page: Page, book: Locator) {
  await expect(book).toBeVisible()
  // The hook and the copy must agree — a hook on the wrong element would satisfy every check
  // below while the button a person actually sees went unverified.
  await expect(book).toHaveAccessibleName(BOOK_CTA)
  // The CTA leaves eno carrying the paid-link disclosure Google requires of an affiliate link —
  // without rel="sponsored" this is a link-scheme violation, not a styling detail.
  // ⚠️ ANCHORED ON WORD BOUNDARIES: a bare /sponsored/ also matches "unsponsored".
  await expect(book).toHaveAttribute('target', '_blank')
  await expect(book).toHaveAttribute('rel', /(^|\s)sponsored(\s|$)/)
  const dest = new URL((await book.getAttribute('href')) || '', page.url())
  // ⚠️ PROTOCOL FIRST. `new URL('javascript:…').hostname` is the empty string, which passes a
  // bare "different hostname" check while being the one href shape that must never ship here.
  expect(dest.protocol).toBe('https:')
  // ⚠️ "NOT THIS HOST" IS TOO WEAK — it blesses www.eno.vn from eno.vn, eno.vn from eno.forum,
  // and https://example.com from anywhere. For a money-adjacent outbound link the contract is the
  // partner's OWN tracker, so pin it against the same catalogue the seeder wrote the hrefs from.
  expect(dest.hostname).not.toMatch(/(^|\.)eno\.(vn|forum)$/)
  // ⚠️ UNCONDITIONAL. Guarding this on `PARTNER_HOSTS.length` would let a checkout with an
  // unreadable catalogue silently drop the one assertion that pins where the money link goes.
  // Callers already skip when the catalogue did not load, so reaching here with none is a bug.
  expect(PARTNER_HOSTS).toContain(dest.hostname)
  // ⚠️ THE ABSENCES ARE THE LOAD-BEARING HALF, AND toHaveCount(0) PASSES ON ITS FIRST POLL —
  // so a build that renders the link and mounts a chat button a beat later would false-green.
  // Report is a CLIENT control every PDP carries: once it is on screen the client tree has
  // mounted, and only then does "not present" mean "not rendered by this product".
  await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible({ timeout: 15000 })
  // A chat gate would invite a guest to negotiate a price the partner sets at checkout, and
  // "ENO protects you" would promise a dispute path for money eno never receives.
  await expect(page.getByRole('button', { name: CHAT_CTA })).toHaveCount(0)
  await expect(page.getByText(/ENO protects you/i)).toHaveCount(0)
}

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
      // ⚠️ `:visible`, NOT `.first()` — THE SAME TRAP THE SAVE-CLUSTER TEST BELOW DOCUMENTS. The PDP
      // renders TWO galleries, the mobile carousel and the desktop mosaic, and only one of them is
      // laid out at any viewport. Both name their photo buttons "<title> — photo N", so `.first()`
      // takes whichever appears first in the DOM regardless of which one the reader can see.
      // Measured on the mobile project: all ten photo buttons resolved at 0x0, the click landed at
      // (0,0), and the copy-discount-code button up in the corner "intercepted pointer events" —
      // an error that reads like an overlapping-layer bug and is nothing of the kind.
      const viewAllHere = page.getByRole('button', { name: /View all photos/i }).locator('visible=true').first()
      const photoHere = page.getByRole('button', { name: /photo 1/i }).locator('visible=true').first()
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
    // Walks up to 12 PDPs looking for one that HAS a chat gate; the default per-test budget is
    // not written for a dozen navigations plus a client-mount wait on each.
    test.setTimeout(180_000)
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
    //
    // ⛔ A PARTNER-AFFILIATE LISTING HAS NO CHAT GATE AT ALL, AND THAT IS THE POINT. VinWonders
    // tickets are booked and paid for on the partner's own site, so the buy box renders
    // <AffiliateBooking> — an outbound link — in place of <ContactComposer>. When one of those is
    // the first live listing, asserting a chat button here goes red on a page behaving exactly as
    // designed. So branch on which product this is and assert THAT product's contract; never skip,
    // because a skip is how the gate quietly stops being tested at all.
    // ⛔ AN EARLIER DRAFT BRANCHED HERE AND `return`ed ON A PARTNER LISTING, WHICH MEANT THE CHAT
    // GATE — the money- and trust-adjacent control this test exists for — went UNTESTED on any day
    // partner stock sorted first. Green, and silently covering nothing. So walk the feed for a
    // listing that actually has a chat gate instead; the partner contract has its own spec below.
    await page.goto('/')
    const cards = page.locator('a[data-card-link]')
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })
    const hrefs: string[] = []
    for (let i = 0; i < Math.min(await cards.count(), 12); i++) {
      const href = await cards.nth(i).getAttribute('href')
      if (href) hrefs.push(new URL(href, page.url()).toString())
    }
    for (const href of hrefs) {
      await page.goto(href)
      // Report is a client control every PDP carries: once it is on screen the client tree has
      // mounted, so "no booking link" means this product has none rather than not-yet-painted.
      await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible({ timeout: 15000 })
      if (await page.locator(BOOK_LINK).count()) continue
      const chat = page.getByRole('button', { name: CHAT_CTA }).first()
      await expect(chat).toBeVisible()
      const dialog = page.getByRole('dialog')
      // A click that lands while useAuth is still resolving is buffered by ContactComposer
      // and drained once auth settles — so a single click always yields the sign-in dialog.
      await chat.click()
      await expect(dialog).toBeVisible({ timeout: 15000 })
      return
    }
    test.skip(true, `every one of the first ${hrefs.length} home cards is a partner ticket — the chat gate has no subject in this catalogue`)
  })

  test('exposes Save / Share / Report controls', async ({ page }) => {
    // "Save listing", not "Save" — the heart is an ARIA toggle, so its name is CONSTANT and
    // `aria-pressed` carries the saved state. It used to flip Save/Saved, which is the pairing
    // that announces "Saved, pressed".
    // ⚠️ SCOPED TO THE ACTION CLUSTER, NOT `.first()`. Every card heart on this page — the
    // similar-listings rail, the seller's other listings — now answers to the SAME name, so a
    // bare `.first()` would happily pass off a card while the PDP's own Save button was gone.
    // The pair with Share is what makes this cluster the detail page's: cards have no Share.
    // ⚠️ `:visible`, NOT `.first()` — the page carries TWO of these clusters, one per gallery
    // (`md:hidden` mobile, desktop), so whichever comes first in the DOM is the hidden one at
    // one of the two viewports this spec runs at.
    const actions = page.locator('div:has(> button[aria-label="Share"]):visible')
    await expect(actions.getByRole('button', { name: /^Save listing$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Share$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible()
  })

  // ⚠️ THE ASSERTION NO OTHER GATE CAN MAKE. `aria-pressed` on the save heart is load-bearing
  // TWICE: it reports the state to a screen reader, and it is what globals.css keys the
  // Outline→Bold glyph swap on. Delete it as "redundant with the label" and the saved heart
  // silently reverts to a red OUTLINE while tsc, design-lint and 3773 unit tests stay green —
  // which is exactly how it shipped on the map card and the video rail (fixed 102ce1ea).
  // The NAME must not move with the state either: a toggle that renames itself announces
  // "Remove favorite, pressed", i.e. that removal is the state you are in.
  // Favourites are localStorage-only, so this writes nothing to the server and stays guest-safe.
  test('the save heart is a real ARIA toggle — pressed flips, the name does not', async ({ page }) => {
    // ⚠️ A CSS LOCATOR, NOT getByRole — and that is not a style preference. Saving as a guest
    // opens the "Saved! Now keep it" sign-up sheet, and a modal marks the background
    // `aria-hidden`, which takes the heart out of the ACCESSIBILITY TREE the moment it is
    // pressed. getByRole then reports "element(s) not found" for a button that is right there
    // and working — a failure that reads like the toggle broke. CSS ignores the a11y tree.
    const heart = page.locator('div:has(> button[aria-label="Share"]):visible button[aria-label="Save listing"]')
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    // The name must NOT have moved with the state — that is the whole point of the toggle.
    await expect(heart).toHaveAttribute('aria-label', 'Save listing')
  })
})

// ⚠️ THE FIRST-LIVE-LISTING SPEC ABOVE ONLY MEETS A PARTNER PRODUCT WHEN ONE HAPPENS TO SORT
// FIRST, so on its own the affiliate contract is tested or not tested depending on the day's
// catalogue ordering. This block removes that coin flip: every partner ticket lives in
// `tickets-travel`, so the category feed is a deterministic way in.
test.describe('Guest · partner ticket (affiliate listing)', () => {
  test('the partner booking contract holds on a ticket opened from its category', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/c/tickets-travel')
    const cards = page.locator('a[data-card-link]')
    // ⚠️ SETTLE BEFORE COUNTING, for the same reason the branch above settles: a bare `count()`
    // polls once and would read 0 on a feed that had simply not painted, turning a stocked
    // environment into a silent skip.
    // ⚠️ AND NOT BY WAITING FOR THE EMPTY-STATE COPY — this site is bilingual, so anchoring the
    // zero-stock path on an English string would turn a legitimately empty database into a 20s
    // timeout instead of the skip it is meant to reach. Poll for cards; absence is the answer.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    let n = 0
    for (let t = 0; t < 20 && !(n = await cards.count()); t++) await page.waitForTimeout(500)
    // No stock here is a real state (a fresh database, a seed not run) and is not a failure of
    // the code under test — but it must be VISIBLE rather than a silent pass.
    if (!n || !PARTNER) test.skip(true, `no tickets-travel stock, or no catalogue to name the partner (PARTNER=${PARTNER || 'unset'})`)

    // ⛔ CLASSIFY BY WHO SELLS IT, NEVER BY WHETHER THE BOOK CTA IS THERE. An earlier draft
    // walked the feed looking for a "Book on" link and skipped when it found none — which is
    // precisely the bug this spec exists to catch, because a partner ticket rendering the
    // ORDINARY buy box (offer slider, chat gate, "ENO protects you") is the failure. Measured:
    // against a deploy without the partner code the CTA-driven version reported "1 skipped"
    // where it had to report red. The storefront link carries the seller's name whether or not
    // the affiliate UI works, so it can tell "no partner stock" from "partner stock, broken".
    //
    // ⚠️ AND "every partner ticket is in tickets-travel" does NOT mean every card here is one —
    // an ordinary seller may post a ticket — so walk rather than trusting the first card.
    // Collected BEFORE navigating: the feed is gone once we leave it, and a rerender between the
    // count and the read can hand back a null href rather than a string.
    const hrefs: string[] = []
    for (let i = 0; i < Math.min(n, 12); i++) {
      const href = await cards.nth(i).getAttribute('href')
      if (href) hrefs.push(new URL(href, page.url()).toString())
    }
    for (const href of hrefs) {
      await page.goto(href)
      // Report is a client control every PDP carries — waiting for it settles the page before
      // any count(), so "no storefront link" means absent rather than not-yet-painted.
      await expect(page.getByRole('button', { name: /^Report$/i })).toBeVisible({ timeout: 15000 })
      if (!(await page.locator('a[href^="/sellers/"]').filter({ hasText: PARTNER }).count())) continue
      await assertPartnerBooking(page, page.locator(BOOK_LINK).first())
      return
    }
    test.skip(true, `no ${PARTNER} listing among the first ${hrefs.length} tickets-travel cards`)
  })
})

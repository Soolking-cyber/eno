// `test` from helpers seeds the privacy-preserving cookie-consent choice before navigation, so the
// first-visit consent dialog covers nothing.
import { test, expect } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// A GUEST'S TAP ON "CHAT" ASKS THEM TO SIGN IN, AND SENDS NOTHING.
//
// Why this lives here and not only in e2e/guest/listing.spec.ts: the guest test walks the live home
// feed for a listing that has a chat button, and on 2026-10-05 the first 12 home cards on both the
// preview and production were outbound-link listings (rentals, cars, jobs, eSIMs, imports) — so it
// skipped, and nothing anywhere exercised the sign-in gate on the money- and trust-adjacent control.
// `ci-l-1` is a seeded native listing (scripts/ci-fixtures.ts), so this always has its subject.
//
// What "gated" means:
//  1. the tap opens THE CHAT GATE for THIS listing: the sign-in card titled with its seller, with its
//     email field, and the stored intent is a chat about ci-l-1 (so sign-in resumes the chat, not an offer);
//  2. nothing of the signed-in path runs: no compose stash, no request to /messages/* (the pending page),
//     no request to the messaging APIs — judged again after a settle window, not only at the first frame;
//  3. the page stays put; closing the gate drops the remembered intent and leaves "Chat now" working (tap → gate again).
//
// Mutation-checked 2026-10-06 against a fixture build: a guest branch that skips the gate fails at (1); a
// gate that opens AND posts /api/conversations 1.5 s later fails at (2) — and passed before the settle window.
//
// ⛔ Fixture-backed like the rest of e2e/ci. Never point E2E_CI_BASE at production.
// ─────────────────────────────────────────────────────────────────────────────

const OWN = '/listings/ci-l-1'
/** Named in full, as in e2e/guest/listing.spec.ts: a /chat/i substring would also match the button's busy label. */
const CHAT_CTA = /^(Chat now|Chat|Nhắn tin ngay|Nhắn tin|Chat ngay)$/i
/**
 * ⛔ THE CLICK MUST WAIT FOR THIS, NOT FOR ANY BUTTON THAT IS MERELY VISIBLE. "Chat now" and "Report"
 * are both in the server-rendered HTML, so they are visible before React attaches a handler — and a
 * tap on them then is lost: measured 2026-10-06 on a cold fixture server, the first attempt's click
 * changed nothing (button idle, no dialog, no navigation) and only the retry passed, which CI's
 * --fail-on-flaky-tests counts as a failure. The guest offer button renders only on the client, after
 * hydration AND after the auth check has settled to "no user" (contact-composer.tsx: `!loading && !user`;
 * the server renders "Send offer" while auth is loading) — so once it is visible, a tap on Chat reaches
 * ContactComposer's guest branch.
 * ⚠️ SINCE 2026-10-07 THE BUTTON ALONE IS NO LONGER THAT SIGNAL: a cookie-less document is server-rendered with the
 * guest panel already showing (the `no-session` variant — no signed-in slider flashing for a guest), so it is
 * visible before hydration. Only the panel auth has settled on carries `data-auth-settled`; the wait is scoped to it.
 */
const GUEST_READY = /^(Sign in to make an offer|Đăng nhập để trả giá)$/i
/** The chat gate's own card, for this listing's seller (sign-in-card.tsx; seller names are not translated). */
const GATE_TITLE = /^(Sign in to message CI Fixture Shop |Đăng nhập để nhắn CI Fixture Shop )/
/** Every write a signed-in tap makes goes through these (src/app/api/conversations, src/app/api/messages)… */
const MESSAGING_API = /^\/api\/(conversations|messages)(\/|$)/
/** …after navigating to /messages/pending, whose RSC fetch is visible here even if the page bounces back. */
const MESSAGES_PAGE = /^\/messages(\/|$)/
/** src/lib/quick-contact.ts COMPOSE_KEY / src/lib/pending-intent.ts INTENT_KEY. */
const COMPOSE_KEY = 'eno-compose'
const INTENT_KEY = 'eno:pending-intent'
/**
 * A send that slipped past the gate shows up after the dialog: an RSC round trip to /messages/pending,
 * the page mounting, then its POST. Asserting at the dialog's first frame decides the question before
 * that request could exist, so the negative checks run again after this window. Any negative check is
 * bounded; 3 s covers that whole path on a cold fixture server (a 1.5 s-delayed POST was caught).
 */
const SETTLE_MS = 3_000

test('a guest who taps Chat gets the sign-in dialog, stays on the listing, and sends nothing', async ({ page, baseURL }) => {
  // The first spec of the ci-fixtures run pays the cold-start cost of this page (first render, first chunk fetches).
  test.slow()
  const origin = new URL(baseURL!).origin
  const sent: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    // A link prefetch is not a navigation: a header link to /messages may warm it. Next 16.3 marks prefetches with
    // either header (node_modules/next/dist/client/components/app-router-headers.js).
    const h = r.headers()
    if (u.origin !== origin || h['next-router-prefetch'] || h['next-router-segment-prefetch']) return
    if (MESSAGING_API.test(u.pathname) || MESSAGES_PAGE.test(u.pathname)) sent.push(`${r.method()} ${u.pathname}${u.search}`)
  })
  const stored = () => page.evaluate(([c, i]) => ({
    compose: sessionStorage.getItem(c),
    intent: JSON.parse(sessionStorage.getItem(i) ?? 'null') as { kind?: string; path?: string; payload?: { listingId?: string } } | null,
  }), [COMPOSE_KEY, INTENT_KEY] as const)

  await page.goto(OWN)
  await expect(page.locator('[data-auth-settled]').getByRole('button', { name: GUEST_READY }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-affiliate-cta]'), 'ci-l-1 is a native listing: no outbound booking link').toHaveCount(0)

  const chat = page.getByRole('button', { name: CHAT_CTA }).first()
  await expect(chat).toBeVisible()
  await chat.click()

  const dialog = page.getByRole('dialog', { name: GATE_TITLE })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('input[type="email"]')).toBeVisible()

  // Decided at once: the signed-in path stashes the compose payload synchronously before it navigates.
  const first = await stored()
  expect(first.compose, 'a guest tap stashes no message').toBeNull()
  expect(first.intent, 'the gate remembers a CHAT about this listing, so sign-in resumes it').toMatchObject({
    kind: 'chat', path: OWN, payload: { listingId: 'ci-l-1' },
  })

  await page.waitForTimeout(SETTLE_MS)
  await expect(dialog, 'the gate stays open: nothing navigated away behind it').toBeVisible()
  expect(new URL(page.url()).pathname).toBe(OWN)
  expect((await stored()).compose, 'still no compose stash after the settle window').toBeNull()
  expect(sent, 'a guest tap must not reach /messages or the messaging APIs').toEqual([])

  // Closing the gate: pending-intent.ts says an intent is "dropped when that sign-in is closed without signing in" —
  // a cancelled chat must not resume at some later, unrelated sign-in.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await stored()).intent, { timeout: 2_000 }).toBeNull()
  // …and the button still works: a control left disabled, or stuck on its busy label "Opening chat…" (which
  // CHAT_CTA does not match), fails here — so does one that no longer reaches the gate.
  const again = page.getByRole('button', { name: CHAT_CTA }).first()
  await expect(again).toBeEnabled({ timeout: 1_000 })
  await again.click()
  await expect(dialog).toBeVisible({ timeout: 5_000 })
})

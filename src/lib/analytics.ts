// Client-side GA4 events (+ Meta Pixel BROWSING events).
// ⛔ THE PIXEL IS NOT DORMANT ANY MORE, AND NOTHING IN THIS REPO TURNED IT ON. This header said
// "window.fbq is never defined and every fb() call below no-ops" from 2026-07-10, when the Pixel
// script was removed from analytics-tags.tsx. That stopped being true on 2026-08-18 (8934e842),
// when eno.forum got a GTM container and CSP was widened to admit `connect.facebook.net` as a tag
// vendor: a Meta Pixel tag added in the GTM web UI now defines `window.fbq`, so every `fb()` call
// below FIRES on eno.forum. Measured on the live site — `typeof window.fbq === 'function'`.
// ⚠️ `fbq('track', …)` BROADCASTS TO EVERY INITIALISED PIXEL ID, so a container carrying two ids
// sends each ViewContent/Search twice — on top of the server-side CAPI, which is the double-count
// the "pixel off" decision existed to prevent. Measured 2026-08-26: `fbq.getState().pixels` held
// TWO (1006148665611946 and 971008779317420). The owner removed the second from GTM the same day;
// re-measured after, one id. ⛔ COUNT THEM, don't assume — nothing in this repo can see or gate
// what the container loads, and `getState().pixels` is the only honest check.
// ⚠️ The surviving id must stay the one `META_PIXEL_ID` posts to, or the `eventID` dedup below
// pairs nothing and the two channels double-count anyway.
// ⚠️ eno.vn is unaffected — it ships no GTM container (NEXT_PUBLIC_GTM_ID is set only in
// eno-services-env), so `fbq` is genuinely undefined there and these calls really do no-op.
// ⛔ SINCE 2026-10-01 THE CSP ADMITS NO META PIXEL HOST ON EITHER EDITION (next.config.ts), so a GTM
// Meta Pixel tag can no longer load its script on eno.forum either: `fbq` stays undefined and the
// fb() calls below no-op everywhere. The history above is why — the container loads before consent.
// GA (gtag) is installed interaction-gated.
//
// IMPORTANT — conversions are server-side now: CompleteRegistration / Contact / Lead
// fire from the API routes via the Meta Conversions API (src/lib/meta-capi.ts), which
// adds ZERO client/first-load cost and isn't blocked by ad-blockers. So the client
// helpers below only keep the *browsing* pixel events (ViewContent/Search) — the ones
// the conversions don't cover.
// ⛔ THEY ARE NO LONGER NON-OVERLAPPING, AND THIS PARAGRAPH USED TO SAY THEY WERE. It read "no
// shared event_id / dedup needed" — true when ViewContent was browser-only. `trackViewListing`
// now fires the Pixel AND `viewContentBeacon` (CAPI, ad-blocker backstop) for the SAME view, so
// the shared `eventId` is what stops Meta counting it twice. Dedup is load-bearing: it needs the
// same event_id (it has one) AND the same pixel id on both sides (`META_PIXEL_ID` server-side vs
// whatever the GTM container initialises — nothing in this repo can check that).
// ⚠️ And the container can widen the overlap further: a Pixel tag with its own PageView/Lead
// triggers duplicates the API-route conversions with NO event_id at all. Check the container.
//
// Every call here is guarded: it no-ops on the server / before the script loads and
// never throws inside a click handler — a dropped event always beats a broken UX.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    fbq?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

import { getAttribution } from './attribution'
import { hasAdConsent, hasAnalyticsConsent } from './consent'
import { IS_MARKETPLACE } from './edition'

export type Currency = 'VND' | 'USD'

/** GA4 measurement id. NEXT_PUBLIC_GA_ID overrides the public default. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-CKTZK62B0X'

/**
 * THE SEO TOOL'S GA4 STREAM — eno.vn only (owner, 2026-10-05: "apply best recommended").
 * The SEO tool reads GA4 property 553789942, whose web stream is this id, and showed 0 rows: production
 * only ever configured GA_ID, which belongs to a different property. So the marketplace configures BOTH
 * (analytics-tags.tsx: one gtag.js, one `config` per id — Google's documented way to send one page to two
 * properties) and every event without a `send_to` reaches both. Same consent gate, same kill switch
 * (consent-runtime.ts sets `ga-disable-<id>` for every id here): nothing loads or sends for either without
 * the Analytics purpose.
 * ⚠️ eno.forum KEEPS EXACTLY ONE ID — the property is eno.vn's. A literal rather than an env var, like
 * GA_ID's default: a measurement id is public (it is in every page), and an env-only value would be one
 * more per-site setting to forget (CLAUDE.md "the trap is config").
 */
export const GA_SEO_ID = 'G-0EXQ7Q17YN'

/**
 * Every GA4 measurement id this build configures, primary first. Pure, so both editions are testable; an id
 * equal to the primary (NEXT_PUBLIC_GA_ID set to the SEO stream) is configured once, never twice.
 */
export function gaMeasurementIds(primary: string, marketplace: boolean): string[] {
  return marketplace && primary !== GA_SEO_ID ? [primary, GA_SEO_ID] : [primary]
}

/** This edition's ids — the marketplace: GA_ID and GA_SEO_ID; eno.forum: GA_ID alone. */
export const GA_IDS: readonly string[] = gaMeasurementIds(GA_ID, IS_MARKETPLACE)

// Convert eno.vn's display symbol ('₫' / '$') to an ISO currency code for analytics.
export function currencyCode(symbol: string): Currency {
  return symbol === '₫' ? 'VND' : 'USD'
}

/**
 * ⛔ EVERY EVENT RE-CHECKS CONSENT, NOT ONLY THE SCRIPT LOADER. v1 checked only that `window.gtag`
 * existed — so after a withdrawal in the same tab the already-loaded gtag kept receiving events until
 * the page was reloaded, while /privacy promised the trackers stop "immediately".
 */
function ga(event: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function' || !hasAnalyticsConsent()) return
  try { window.gtag('event', event, params) } catch { /* analytics must never break UX */ }
}

/**
 * ⛔ ADVERTISING CONSENT, CHECKED HERE — the one gate this repo controls in front of a Pixel it does not
 * load. `window.fbq` can only come from a tag in eno.forum's GTM container (paused as of 2026-09-23);
 * if that tag is ever unpaused, every call below would otherwise fire for visitors who said no.
 */
function fb(event: string, params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function' || !hasAdConsent()) return
  // 4th fbq arg is the options bag — passing the same event_id the CAPI uses lets Meta
  // DEDUPE the Pixel event against the server-side one.
  try { window.fbq('track', event, params, eventId ? { eventID: eventId } : undefined) } catch { /* analytics must never break UX */ }
}

// Drop undefined/null keys so we never send empty params to the vendors.
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null))
}

function newEventId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

// Fire-and-forget POST to our first-party CAPI relay for ViewContent. sendBeacon survives
// page unload and sends same-origin cookies (so _fbp/_fbc reach the server for matching).
function viewContentBeacon(id: string, eventId: string): void {
  try {
    const payload = JSON.stringify({ id, eventId })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/view', new Blob([payload], { type: 'application/json' }))
    } else {
      // ⚠️ SILENCE IS CORRECT HERE, UNLIKE EVERYWHERE ELSE THIS PATTERN APPEARS. This whole file is
      // client-side GA4/beacon plumbing (see the header), so there is no server log for `logError`
      // to reach — it would print JSON into the visitor's own console and nothing into Cloud
      // Logging. The file's own rule is "analytics must never break UX", and a dropped view-beacon
      // is not an incident. The disable is narrow, on one line, and states its reason.
      // eslint-disable-next-line no-restricted-syntax
      fetch('/api/track/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
    }
  } catch { /* analytics must never break UX */ }
}

/** A buyer opens a listing detail page. GA4 view_item / Meta ViewContent. */
export function trackViewListing(p: { id: string; title: string; price: number; currency: Currency; category: string }): void {
  ga('view_item', {
    currency: p.currency,
    value: p.price,
    items: [{ item_id: p.id, item_name: p.title, item_category: p.category, price: p.price }],
  })
  // One event_id shared by the Pixel + the server-side CAPI backstop → Meta merges them.
  const eventId = newEventId()
  fb('ViewContent', {
    content_ids: [p.id],
    content_type: 'product',
    content_name: p.title,
    content_category: p.category,
    value: p.price,
    currency: p.currency,
  }, eventId)
  // CAPI ViewContent survives ad-blockers that drop the Pixel — fired ONLY with the
  // advertising purpose (consent v2 `d`; never inside the native apps). The server
  // re-checks the same cookie before anything reaches Meta.
  if (hasAdConsent()) viewContentBeacon(p.id, eventId)
}

/** A committed search (debounced + settled, ≥2 chars). GA4 search / Meta Search. */
export function trackSearch(p: { term: string; results?: number; category?: string; contentIds?: string[] }): void {
  ga('search', clean({ search_term: p.term, number_of_results: p.results }))
  fb('Search', clean({
    search_string: p.term,
    content_type: 'product',
    content_category: p.category,
    content_ids: p.contentIds && p.contentIds.length ? p.contentIds : undefined,
  }))
}

/** A buyer starts a NEW conversation with a seller. GA4 generate_lead. (Meta Contact
 *  is sent server-side via CAPI from the contact route — not here.) */
export function trackContactSeller(p: { id: string; title?: string; price?: number; currency?: Currency }): void {
  ga('generate_lead', clean({ method: 'message_seller', item_id: p.id, item_name: p.title, value: p.price, currency: p.currency }))
}

/** A seller publishes a listing. GA4 post_listing (custom). (Meta Lead is sent
 *  server-side via CAPI from POST /api/listings — not here.) */
export function trackPostListing(p: { id?: string; title: string; price: number; currency: Currency; category: string; district?: string }): void {
  ga('post_listing', clean({ currency: p.currency, value: p.price, item_category: p.category, item_name: p.title, item_id: p.id, district: p.district }))
}

/** A brand-new account is created. GA4 sign_up. (Meta CompleteRegistration is sent
 *  server-side via CAPI from the account-type route — not here.) */
export function trackSignUp(method: string): void {
  // Enrich the GA4 sign_up with our first-touch channel so GA's own reports can break
  // signups down by the channel that originally brought the user (CAC per channel).
  const a = getAttribution()
  ga('sign_up', clean({ method, source: a?.source, medium: a?.medium, campaign: a?.campaign }))
}

/** What the "Join eno" prompt reports — shown, closed without signing in, or which method was chosen. */
export type SignupPromptEvent = 'shown' | 'dismissed' | 'google' | 'apple' | 'email'

/**
 * The "Join eno" prompt (signup-prompt.tsx): GA4 `signup_prompt_shown` / `_dismissed` / `_google` /
 * `_apple` / `_email`. Through `ga()`, so it re-checks the ANALYTICS purpose on every event — without that switch
 * nothing leaves the device, exactly like every other event here. `prompt_count` is which ask this was
 * in the tab session (1 or 2), so the second ask can be measured against the first.
 * ⚠️ NOT a Meta event: the conversion that matters (sign_up) is already counted by trackSignUp and
 * server-side CAPI; these only say how the prompt itself performs. The anonymous daily totals the owner
 * reviews are a SEPARATE path (signup-prompt.tsx countSignupPrompt → /api/signup-prompt), not this one.
 */
export function trackSignupPrompt(event: SignupPromptEvent, p?: { count?: number }): void {
  ga(`signup_prompt_${event}`, clean({ prompt_count: p?.count }))
}

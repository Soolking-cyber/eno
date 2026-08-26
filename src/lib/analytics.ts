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
import { hasAdConsent } from './consent'

export type Currency = 'VND' | 'USD'

// Convert eno.vn's display symbol ('₫' / '$') to an ISO currency code for analytics.
export function currencyCode(symbol: string): Currency {
  return symbol === '₫' ? 'VND' : 'USD'
}

function ga(event: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  try { window.gtag('event', event, params) } catch { /* analytics must never break UX */ }
}

function fb(event: string, params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
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
  // CAPI ViewContent survives ad-blockers that drop the Pixel — fired ONLY with ad
  // consent (mirrors the Pixel's own gating; respects the consent tiers).
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

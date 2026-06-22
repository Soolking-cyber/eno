// GA4 conversion events (+ Meta Pixel events kept wired but DORMANT). The Meta
// Pixel script was removed from analytics-tags.tsx for performance, so window.fbq
// is never defined and every fb() call below no-ops — re-adding the Pixel script
// re-enables them with no other change. GA (gtag) is installed interaction-gated.
// Every call here is guarded: it no-ops on the server / before the script loads and
// never throws inside a click handler — a dropped event always beats a broken UX.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    fbq?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

export type Currency = 'VND' | 'USD'

// Convert eno.vn's display symbol ('₫' / '$') to an ISO currency code for analytics.
export function currencyCode(symbol: string): Currency {
  return symbol === '₫' ? 'VND' : 'USD'
}

function ga(event: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  try { window.gtag('event', event, params) } catch { /* analytics must never break UX */ }
}

function fb(event: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  try { window.fbq('track', event, params) } catch { /* analytics must never break UX */ }
}

// Drop undefined/null keys so we never send empty params to the vendors.
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null))
}

/** A buyer opens a listing detail page. GA4 view_item / Meta ViewContent. */
export function trackViewListing(p: { id: string; title: string; price: number; currency: Currency; category: string }): void {
  ga('view_item', {
    currency: p.currency,
    value: p.price,
    items: [{ item_id: p.id, item_name: p.title, item_category: p.category, price: p.price }],
  })
  fb('ViewContent', {
    content_ids: [p.id],
    content_type: 'product',
    content_name: p.title,
    content_category: p.category,
    value: p.price,
    currency: p.currency,
  })
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

/** A buyer starts a NEW conversation with a seller. GA4 generate_lead / Meta Contact. */
export function trackContactSeller(p: { id: string; title?: string; price?: number; currency?: Currency }): void {
  ga('generate_lead', clean({ method: 'message_seller', item_id: p.id, item_name: p.title, value: p.price, currency: p.currency }))
  fb('Contact', clean({ content_ids: [p.id], content_type: 'product', content_name: p.title, value: p.price, currency: p.currency }))
}

/** A seller publishes a listing. GA4 post_listing (custom) / Meta Lead. */
export function trackPostListing(p: { id?: string; title: string; price: number; currency: Currency; category: string; district?: string }): void {
  ga('post_listing', clean({ currency: p.currency, value: p.price, item_category: p.category, item_name: p.title, item_id: p.id, district: p.district }))
  fb('Lead', clean({ content_category: p.category, content_name: p.title, content_ids: p.id ? [p.id] : undefined, value: p.price, currency: p.currency }))
}

/** A brand-new account is created. GA4 sign_up / Meta CompleteRegistration. */
export function trackSignUp(method: string): void {
  ga('sign_up', { method })
  fb('CompleteRegistration', { status: true, content_name: 'eno_account', method })
}

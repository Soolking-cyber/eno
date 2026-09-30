/**
 * Is a Rever.vn rental still on the market? Read from the listing page's OWN status badge.
 *
 * ⛔ "THE PAGE CONTAINS 'Đã thuê'" IS WRONG, AND IT IS THE OBVIOUS TEST. Every Rever detail page
 * carries a strip of RELATED listings, and each related card prints its own status
 * (`<div class="status rever-color">Đã thuê</div>`). Measured 2026-09-30: a live town house page
 * held the phrase five times, all of it from its neighbours. A text search would hide live flats.
 *
 * ✅ THE LISTING'S OWN STATE is the one `class="label-…"` badge in its header: "Sẵn sàng giao dịch"
 * (ready to transact) while it is available, "Đã thuê" once it is let — confirmed on two listings
 * Rever's own cards flag as rented. The related cards use `class="status …"`, never `label-`.
 *
 * ⚠️ RETIRE ONLY ON A POSITIVE SIGNAL. Anything this does not recognise — no badge, two badges, a
 * new wording, a redirect to a search page, a timeout — is 'unknown' and hides nothing, the same
 * rule every other importer's retire pass follows (import-rever-rentals.ts, import-muaban-net.ts).
 */

export type ReverVerdict = 'live' | 'rented' | 'gone' | 'unknown'
export interface ReverLiveness { verdict: ReverVerdict; http: number; label: string | null }

const LIVE = 'Sẵn sàng giao dịch'
const RENTED = 'Đã thuê'

/** Text of every `class="label-…"` badge on the page, NFC-normalised and trimmed. */
export function reverStatusLabels(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/class="label-[^"]*"\s*>\s*([^<]{2,60}?)\s*</g)) out.push(m[1].normalize('NFC').trim())
  return out
}

/**
 * ⚠️ A PRICE-DROP BADGE ("giảm 7%") SHARES THE `label-` CLASS and sits beside the status — measured on
 * 17% of live pages, 2026-09-30. It says nothing about availability, so it is set aside; left in, those
 * pages read as "two badges" and a let flat with a recent price cut would never be retired.
 */
const PRICE_DROP = /^giảm\s*\d+(?:[.,]\d+)?\s*%$/i

/** The verdict from an answered page's status badges — also used to re-judge a saved status file. */
export function verdictFromLabels(http: number, rawLabels: string[]): ReverLiveness {
  if (http === 404 || http === 410) return { verdict: 'gone', http, label: null }
  if (http !== 200) return { verdict: 'unknown', http, label: null }
  const all = rawLabels.map((l) => l.normalize('NFC').trim()).filter(Boolean)
  const labels = all.filter((l) => !PRICE_DROP.test(l))
  const label = all.join(' | ') || null
  if (labels.length !== 1) return { verdict: 'unknown', http, label }
  if (labels[0] === RENTED) return { verdict: 'rented', http, label }
  if (labels[0] === LIVE) return { verdict: 'live', http, label }
  return { verdict: 'unknown', http, label }
}

export function classifyReverLiveness(http: number, html: string): ReverLiveness {
  if (http !== 200) return verdictFromLabels(http, [])
  // A removed listing that redirects to a search page still answers 200 — it has no detail header.
  if (!/<h1[\s>]/.test(html)) return { verdict: 'unknown', http, label: null }
  return verdictFromLabels(http, reverStatusLabels(html))
}

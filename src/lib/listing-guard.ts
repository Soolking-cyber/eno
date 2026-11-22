import { kv } from '@/lib/ratelimit'
import { logError, logInfo } from '@/lib/log'
import { formatMoneyFull } from '@/lib/vnd'
import { PublishBlockedError } from '@/lib/publish-guard'
import { photoCheckExemptFor } from '@/lib/listing-photo-refusal'
import type { ListingGuardCode } from '@/lib/listing-guard-copy'

/**
 * THE LISTING GUARD (owner, 2026-11-22: "add a proper jev guardrail so we dont have improper posts without price or location
 * promotion like these … all products should have proper price … it should consume less jev tokens"). The examples: a café's
 * "Which Flavor are you Choosing Today?" at 0 đ and a singer's show promo at 1 đ, both live under Food & drink.
 *
 * Two steps, the free one first, on every new post and on every edit of its words, price or intent — except the storefronts
 * the photo check never touches (photoCheckExemptFor: teachers, the owner's protected stores, eno's desks, official partners):
 *  1. THE PRICE FLOOR, no model: a priced intent (sell, rent, wholesale, service, event) under 1.000 đ → `price_required`.
 *     A giveaway is the `free` intent; a job, a teacher and a wanted post carry no asking price.
 *  2. JEV (TypeSafe's decision model: typed yes/no answers as probabilities), on the words only — photos already have the
 *     Publish photo check (listing-photo-check.ts: flyers, phone numbers) — in ONE call with at most two questions:
 *     an advert rather than an offer (≥ 0.70 → `not_a_listing`), and, for a priced intent, a placeholder price
 *     (≥ 0.85 → `price_placeholder`). About 470 input tokens a post (output is free): ≈ $0.00002.
 *
 * Thresholds measured 22 Nov 2026 with jev-1.14.0 on 1,111 listings: 0 of 391 official-partner listings and 0 of 619 past
 * user listings scored 0.6 or more as an advert; the live adverts scored 0.74–0.95; the highest real listing 0.63 ("PS5 games
 * for sale"). Placeholder price: the 1 đ show 0.92 and casino-script spam at 10–11 đ 0.88–0.93; real listings ≤ 0.70.
 * ⛔ The model is PINNED (jev-1.14.0): the thresholds belong to that build; re-measure before moving it.
 * ⛔ FAILS OPEN: no key, over the day's cap, past the 2.5 s deadline, or any HTTP or shape error → the post goes on, logged.
 *    The floor never depends on the model; location, photos and contact details stay with assertPublishable.
 */

export const MIN_PRICE_VND = 1_000

export { LISTING_GUARD_REFUSAL, isListingGuardCode, type ListingGuardCode } from '@/lib/listing-guard-copy'
const PRICED_INTENTS = new Set(['sell', 'rent', 'wholesale', 'service', 'event'])
export const isPricedIntent = (listingType: string) => PRICED_INTENTS.has(listingType)

/** The floor: a priced intent with no real price. Pure — every path calls this before any model. */
export function priceFloorProblem(listingType: string, price: number): Extract<ListingGuardCode, 'price_required'> | null {
  return isPricedIntent(listingType) && !(price >= MIN_PRICE_VND) ? 'price_required' : null
}

export const JEV_MODEL = 'jev-1.14.0'
export const JEV_THRESHOLDS = { promo: 0.7, fakePrice: 0.85 } as const
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_DEADLINE_MS = 2_500
/**
 * Calls a UTC day. PER STOREFRONT (500) the cap FAILS CLOSED: past it the post is refused until tomorrow
 * (`listing_check_limit`), so a spending limit is never a way round the check — a script that burns its calls on refused
 * posts then gets nothing through (commit gate round 2, codex + opus). FOR EVERYONE (200,000 ≈ $4 a day at ~470 tokens) it
 * fails open — honest sellers are never blocked by others' volume; reaching it takes 400 storefronts at their own cap.
 */
export const JEV_DAILY_CAP = 200_000
export const JEV_SELLER_DAILY_CAP = 500
const DESCRIPTION_CHARS = 500
const BULK_BUDGET_MS = 20_000

// ⚠️ The words are the measured ones (22 Nov 2026) — a reworded question needs its thresholds measured again.
const PROMO_QUESTION = { type: 'noul', instructions: 'This marketplace post advertises a business, venue, event, show, menu, brand or deal instead of offering one specific item, property, vehicle, job, lesson or service for sale, rent or hire.' }
const FAKE_PRICE_QUESTION = { type: 'noul', instructions: 'The stated price is a placeholder or token amount (such as 1 đ, 0 or 1,000 đ for something clearly worth far more) rather than the real asking price. A genuine free giveaway, a salary, or a job with no price is NOT a placeholder.' }

/**
 * ⛔ NOT IN COMMUNITY (community-events: meetups, language exchange, classes, clubs, lost & found): a notice about an event or
 * a club IS that category's post, and the advert question names events and shows (commit gate, opus). The price question
 * still runs there for a paid event; a free one is posted as Free.
 */
const NO_PROMO_QUESTION_IN = new Set(['community-events'])
const askPromoIn = (category: string) => !NO_PROMO_QUESTION_IN.has(category)

export type GuardListing = {
  sellerId: string
  category: string
  subcategory?: string | null
  listingType: string
  title: string
  description?: string | null
  price: number
  district?: string | null
}

/** What Jev reads: the post as a buyer would, the description cut to 500 characters. */
export function jevState(l: GuardListing): string {
  // "25,000 đ": the shape the thresholds were measured on (formatMoneyFull's English grouping).
  const price = l.price > 0 ? formatMoneyFull(l.price, '₫', 'en') : 'none'
  const description = (l.description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS)
  return `Category: ${l.category}\nListing type: ${l.listingType}\nTitle: ${l.title}\nPrice: ${price}\nArea: ${l.district || '—'}\nDescription: ${description}`
}

const day = () => new Date().toISOString().slice(0, 10)
/**
 * One call, charged to the storefront and then to everyone; a refused charge is given back. 'seller_cap' = this storefront
 * is past its own cap (the caller refuses); 'off' = no call (the global cap, or the counter is down: fail open).
 */
async function chargeJev(sellerId: string): Promise<'ok' | 'seller_cap' | 'off'> {
  const sellerKey = `listing-guard-jev-seller:${sellerId}:${day()}`
  const globalKey = `listing-guard-jev:${day()}`
  let sellerCharged = false
  try {
    const mine = await kv.incrby(sellerKey, 1, 2 * 86_400)
    sellerCharged = true
    if (mine > JEV_SELLER_DAILY_CAP) {
      await kv.incrby(sellerKey, -1, 2 * 86_400)
      sellerCharged = false
      logInfo('listing_guard_jev_seller_cap', { sellerId, cap: JEV_SELLER_DAILY_CAP })
      return 'seller_cap'
    }
    if ((await kv.incrby(globalKey, 1, 2 * 86_400)) <= JEV_DAILY_CAP) return 'ok'
    await kv.incrby(globalKey, -1, 2 * 86_400)
    logInfo('listing_guard_jev_cap', { cap: JEV_DAILY_CAP })
  } catch { /* the counter is down: no call, fail open */ }
  // No call is made: give the storefront's charge back (best effort — a counter that is down stays down).
  if (sellerCharged) await kv.incrby(sellerKey, -1, 2 * 86_400).catch((e) => logError(e, { op: 'listing_guard.refund' }))
  return 'off'
}

const probability = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null)

export type JevVerdict = { promo: number; fakePrice: number | null; tokens: number }

/**
 * One Jev call. null = not checked (no key, the global cap, deadline, error, an answer of the wrong shape) — the caller lets it
 * pass. 'seller_cap' = the storefront is past its own cap — the caller refuses.
 */
export async function jevVerdict(l: GuardListing): Promise<JevVerdict | null | 'seller_cap'> {
  const key = process.env.TYPESAFE_API_KEY?.trim()
  if (!key) return null
  const priced = isPricedIntent(l.listingType)
  const askPromo = askPromoIn(l.category)
  if (!priced && !askPromo) return null
  const charge = await chargeJev(l.sellerId)
  if (charge === 'seller_cap') return 'seller_cap'
  if (charge === 'off') return null
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(JEV_DEADLINE_MS),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: jevState(l), questions: { ...(askPromo ? { promo: PROMO_QUESTION } : {}), ...(priced ? { fake_price: FAKE_PRICE_QUESTION } : {}) } }),
    })
    if (!res.ok) { logInfo('listing_guard_jev_http', { status: res.status }); return null }
    const j = await res.json() as { answers?: Record<string, { noul?: unknown }>; usage?: { input_tokens?: unknown } }
    const promo = askPromo ? probability(j.answers?.promo?.noul) : 0
    const fakePrice = priced ? probability(j.answers?.fake_price?.noul) : null
    if (promo === null || (priced && fakePrice === null)) { logInfo('listing_guard_jev_shape', {}); return null }
    return { promo, fakePrice, tokens: Number(j.usage?.input_tokens) || 0 }
  } catch (e) {
    // A timeout is the expected failure; anything else is logged as an error. Either way the post goes on.
    if ((e as { name?: string })?.name === 'TimeoutError') logInfo('listing_guard_jev_timeout', { ms: JEV_DEADLINE_MS })
    else logError(e, { op: 'listing_guard_jev' })
    return null
  }
}

/** The photo check's exemption (photoCheckExemptFor). A failed read exempts nothing — its own rule — so the guard runs. */
async function guardExempt(l: Pick<GuardListing, 'category' | 'subcategory' | 'sellerId'>): Promise<boolean> {
  try {
    return await photoCheckExemptFor({ category: l.category, subcategory: l.subcategory, sellerId: l.sellerId })
  } catch (e) {
    logError(e, { op: 'listing_guard_exempt' })
    return false
  }
}

/** The refusal a verdict carries, if any. Pure. */
export function jevProblem(v: JevVerdict): 'not_a_listing' | 'price_placeholder' | null {
  if (v.promo >= JEV_THRESHOLDS.promo) return 'not_a_listing'
  if (v.fakePrice !== null && v.fakePrice >= JEV_THRESHOLDS.fakePrice) return 'price_placeholder'
  return null
}

/**
 * The guard. Throws PublishBlockedError (`price_required` | `not_a_listing` | `price_placeholder`), which every create and edit
 * path already answers as a 400 with that code. An exempt storefront is never checked, so it never costs a call.
 */
export async function assertListingGuard(l: GuardListing): Promise<void> {
  if (await guardExempt(l)) return
  const floor = priceFloorProblem(l.listingType, l.price)
  if (floor) throw new PublishBlockedError(floor)
  const v = await jevVerdict(l)
  if (v === 'seller_cap') throw new PublishBlockedError('listing_check_limit')
  if (!v) return
  const problem = jevProblem(v)
  logInfo('listing_guard_jev', { promo: v.promo, fakePrice: v.fakePrice, tokens: v.tokens, refused: problem, category: l.category, listingType: l.listingType })
  if (problem) throw new PublishBlockedError(problem)
}

/**
 * BULK (bulk.ts: a CSV, /api/v1 bulk, MCP bulk, a partner sync's creates): many rows of ONE storefront, up to 200. Its
 * exemption is asked once per category; the floor per row; Jev for the rows past the floor, eight at a time, BEFORE the caller's sequential loop — one
 * call a row inside that loop would outlast Cloudflare's 100 s on a full file. A `null` row is one the loop refuses anyway:
 * no call. Returns each row's refusal, or null.
 */
export async function listingGuardProblems(sellerId: string, rows: (Omit<GuardListing, 'sellerId'> | null)[]): Promise<(ListingGuardCode | null)[]> {
  const out: (ListingGuardCode | null)[] = rows.map(() => null)
  // The exemption per category (photoCheckExempt reads the category: teachers, an ownerless eSIM aisle), asked once each.
  const exemptIn = new Map<string, Promise<boolean>>()
  const exempt = (r: Omit<GuardListing, 'sellerId'>) => {
    const k = `${r.category}|${r.subcategory ?? ''}`
    if (!exemptIn.has(k)) exemptIn.set(k, guardExempt({ ...r, sellerId }))
    return exemptIn.get(k)!
  }
  const pending: number[] = []
  for (const [i, r] of rows.entries()) {
    if (!r || await exempt(r)) continue
    const floor = priceFloorProblem(r.listingType, r.price)
    if (floor) out[i] = floor
    else pending.push(i)
  }
  // ⛔ A TIME BUDGET (commit gate round 2, opus): calls that all hit the 2.5 s deadline would hold a full file ~63 s before
  // the loop's own image work starts, past Cloudflare's 100 s. After 20 s no new call starts; the rows left are unchecked
  // (fail open, as for any unavailable call) and logged.
  const until = Date.now() + BULK_BUDGET_MS
  let next = 0
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (next < pending.length) {
      if (Date.now() > until) { logInfo('listing_guard_bulk_budget', { unchecked: pending.length - next }); next = pending.length; break }
      const i = pending[next++]
      const v = await jevVerdict({ ...rows[i]!, sellerId })
      if (v === 'seller_cap') { out[i] = 'listing_check_limit'; continue }
      if (!v) continue
      out[i] = jevProblem(v)
      logInfo('listing_guard_jev', { promo: v.promo, fakePrice: v.fakePrice, tokens: v.tokens, refused: out[i], category: rows[i]!.category, listingType: rows[i]!.listingType, bulk: true })
    }
  }))
  return out
}

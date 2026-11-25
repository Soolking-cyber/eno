import 'server-only'
import { db } from '@/lib/db'

/**
 * ── CREATIVE ADS' PRIVATE TEST (owner 2026-11-25: "let me test locally ads before publishing to everyone"). The switch is
 * the server env ADS_CREATIVE_OPEN: '1' opens creative ads (any advertiser's own ad in the feed card) to every shop;
 * anything else, unset included, is the private test:
 *   · BUYING — POST /api/v1/ads with {creative} or {creativeId}, and MCP create_ad, answer only an admin's credential
 *     (ApiAuth.profileId → Profile.email ∈ ADMIN_EMAILS); anyone else gets 403 `creative_ads_not_open` BEFORE any review
 *     (no Jev or Gemini spend) and before any 402. bookAd checks it again before the facilitator is asked anything, so a
 *     payment cannot book one either.
 *   · SERVING — a creative joins the feed only when the request carries `adpreview=1` (serve.ts pickAd); the explorer
 *     forwards it from the page's own URL, and such a response is `private, no-store` (feed-payload.ts), so the edge never
 *     keeps a preview feed. Without it, no creative is served while closed.
 *   · THE OFFER (GET /api/v1/ads/offer, MCP get_ad_offer) says `creative_ads.status: 'testing'` with one sentence.
 * Listing ads ({listingId}, promote_listing) are not affected.
 */
export function creativeAdsOpen(): boolean {
  return process.env.ADS_CREATIVE_OPEN?.trim() === '1'
}

export const CREATIVE_ADS_NOT_OPEN = { status: 403, code: 'creative_ads_not_open', message: 'Your own ads open soon; listing ads are on sale now.' } as const

/** The offer's sentence while testing (null once open). Nothing about listing ads: the offer's own `available` says that
 *  (commit gate, opus: "listing ads are on sale now" beside `available: false` would be false). */
export const CREATIVE_ADS_TESTING_NOTE = 'Your own ads are in a private test; sales open to every shop after that test.'

/** Whether this credential's person may buy a creative ad now: anyone when open; while testing, an admin only. A database
 *  error throws (the caller answers 5xx): never a guess either way. */
export async function creativeAdsAllowed(profileId: string | null | undefined): Promise<boolean> {
  if (creativeAdsOpen()) return true
  if (!profileId) return false
  const p = await db.profile.findUnique({ where: { id: profileId }, select: { email: true } })
  // Loaded here, not at the top: admin.ts brings the session and Supabase modules, and the offer and the feed's ad server
  // (offer.ts, serve.ts, which import this file for the switch alone) never need them.
  const { isAdminEmail } = await import('@/lib/admin')
  return isAdminEmail(p?.email)
}

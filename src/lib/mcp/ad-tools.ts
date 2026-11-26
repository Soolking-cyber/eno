import 'server-only'
import { z } from 'zod'
import { AD_MAX_HOURS, adHours, adPriceAtomicFor, x402Config, usdcText } from '@/lib/x402/config'
import { MCP_META_PAYMENT, MCP_META_RESPONSE } from '@/lib/x402/wire'
import { adOffer, adPaymentRequired, AD_POLICY_URL } from '@/lib/ads/offer'
import { AD_CREATIVE_MAX_HOURS, bookAd, checkAdListing, shopAds } from '@/lib/ads/book'
import { reviewCreative, type ReviewView } from '@/lib/ads/creative-review'
import { shopAdFigures } from '@/lib/ads/stats'
import { CREATIVE_ADS_NOT_OPEN, creativeAdsAllowed } from '@/lib/ads/creative-gate'
import { adView, bookFailureMessage, PENDING_MESSAGE } from '@/lib/ads/answer'
import { ToolError, ToolPaymentRequired, ToolResultWithMeta, type McpTool, type ToolAnnotations } from './tool-types'

/**
 * ── PAID ADS FOR AI AGENTS (owner 2026-11-23: "paid ad creation via mcp for ai agents to pay get our stats and post in
 * app an ad like normal product but labeled as ad … pay through x402"). Three tools on the signed-in shop server:
 *   get_ad_offer   — the price, the placements, the public audience figures, and whether a listing can be advertised;
 *   promote_listing — buys a 7-day ad for one of the shop's listings over x402 (specs/transports-v2/mcp.md): the first
 *                     call answers PaymentRequired as an error result; the same call with params._meta["x402/payment"]
 *                     pays, and its result carries _meta["x402/payment-response"];
 *   list_ads       — the shop's ads with impressions, taps and the listing's views and contacts during each ad;
 *   get_ad_stats   — one ad's figures LIVE, to industry standard (src/lib/ads/stats.ts).
 * And since 2026-11-25 (owner: "enable any type of ads except the restricted ones by vietnamese law, jev should check
 * before they pay"): create_ad — the shop's OWN ad (a picture, a headline in any language, its https page) in the one
 * standard placement, the feed card, REVIEWED before any payment request (src/lib/ads/creative-review.ts): a refusal is
 * answered as the review (reasons, nothing to pay), an approval as the x402 payment request. Scope ads:write.
 * The money path is src/lib/ads/book.ts, the same one POST /api/v1/ads takes.
 */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
// ⛔ DESTRUCTIVE (2026-11-26, OpenAI's app review on promote_listing and create_ad: "destructiveHint: false, but its behavior
// appears to cause material loss or a hard-to-reverse change"). A settled USDC payment cannot be pulled back, and the ad then
// shows to the public; a repeat with a NEW payment buys another run. So a client asks before each call, as it does before a send.
const PAID_WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }

// The stored ListingAd.status values (book.ts writes exactly these five). An enum, not prose (Manufact 2026-11-24,
// outputs 87/88/85: a closed set described in words reads as an undocumented string). promote_listing takes all five:
// book.ts's settle-error path answers `pending` with the row as reconcileAd left it, which can be 'failed' — an answer
// after a payment attempt must never fail a client's output validation. list_ads reads only the four live ones
// (shopAds' where), so its enum has those.
const AD_STATUS = z.enum(['active', 'pending', 'unknown', 'review'])
const AD_STATUS_ANY = z.enum(['active', 'pending', 'unknown', 'review', 'failed'])
// ⛔ tools.ts' rule for a value READ FROM THE DATABASE: one the enum does not list must never fail a validating client's
// whole answer, so it reads as 'unknown' ("confirmation not yet found") — book.ts writes no other value today.
const asAdStatus = <E extends z.ZodEnum>(e: E, v: string): z.infer<E> => (e.options as readonly string[]).includes(v) ? (v as z.infer<E>) : ('unknown' as z.infer<E>)

const AD_OUT = z.strictObject({
  id: z.string().describe('The ad\'s id, as list_ads shows it'),
  listing_id: z.string().nullable().describe('The advertised listing; null for a creative ad (create_ad)'),
  creative_id: z.string().nullable().describe('The ad creative it shows (create_ad); null for a listing ad'),
  status: AD_STATUS_ANY.describe('"active": paid, shown between starts_at and ends_at; "pending" or "unknown": payment sent, confirmation not yet found, it starts once found (call promote_listing again with the same payment to check); "review": being checked by hand; "failed": the payment did not go through, so the ad will not run'),
  hours: z.number().describe('How many hours it runs, as bought'),
  starts_at: z.string().nullable().describe('When it starts being shown (ISO 8601); a second ad for the same listing starts when the first ends. Null until paid'),
  ends_at: z.string().nullable().describe('When it stops being shown (ISO 8601). Null until paid'),
  tx_hash: z.string().nullable().describe('The payment\'s transaction on the network; null until it is known'),
  network: z.string().describe('The payment network, as a CAIP-2 id (eip155:8453 is Base)'),
  amount_atomic: z.string().describe('The price paid, in the token\'s smallest unit (USDC has 6 decimals: 3760000 is 3.76 USDC)'),
})

const STATS_OUT = z.strictObject({
  id: z.string().describe('The ad\'s id'),
  listing_id: z.string().nullable().describe('The advertised listing; null for a creative ad'),
  creative_id: z.string().nullable().describe('The ad creative it shows; null for a listing ad'),
  status: AD_STATUS.describe('"active" (running or booked), "pending" or "unknown" (payment not yet confirmed, see promote_listing) or "review" (being checked by hand)'),
  hours: z.number().describe('How many hours it runs, as bought'),
  starts_at: z.string().nullable().describe('When it started or starts (ISO 8601); null until paid'),
  ends_at: z.string().nullable().describe('When it ends or ended (ISO 8601); null until paid'),
  impressions: z.number().describe('Times the ad card was at least half on screen for a second, during its run (at most once per visitor per 10 minutes)'),
  clicks: z.number().describe('Taps on the ad card during its run (same limit)'),
  listing_views: z.number().nullable().describe('The listing\'s page views from the day the ad started (to its end, or now): from daily snapshots, so ad and non-ad visits together. Null when not measurable yet, and always for an ad shorter than a day'),
  listing_contacts: z.number().nullable().describe('Signed-in buyers who opened the seller\'s contact over the same days; null when not measurable yet'),
  currency: z.enum(['USDC', 'VND']).describe('What it was paid in: "USDC" over x402, or "VND" by bank transfer (bought by a person at /dashboard/ads)'),
  amount_usdc_atomic: z.string().nullable().describe('The price paid, in USDC\'s smallest unit (6 decimals); null for an ad paid in VND'),
  amount_vnd: z.number().nullable().describe('The price paid in Vietnamese đồng, for an ad paid by bank transfer; null for one paid in USDC'),
  network: z.string().describe('The payment network (CAIP-2), or "vietqr" for a bank transfer'),
  tx_hash: z.string().nullable().describe('The payment\'s transaction; null until known'),
})

const REVIEW_OUT = z.strictObject({
  status: z.enum(['approved', 'refused', 'removed']).describe('"approved": it can be paid for; "refused": it broke a rule (see reasons); "removed": eno took it down'),
  creative_id: z.string().nullable().describe('The reviewed creative, to pay for again with creativeId; null when a field was invalid (nothing stored)'),
  reasons: z.array(z.strictObject({
    code: z.string().describe('A stable reason code, such as banned_gambling or image_too_small'),
    en: z.string().describe('The reason in English'),
    vi: z.string().describe('The reason in Vietnamese'),
  })).describe('Why it was refused; empty when approved'),
  permit_classes: z.array(z.string()).describe('Permit classes it falls in, such as cosmetics or finance: allowed, and recorded for eno\'s reviewers'),
  reused: z.boolean().describe('True when this is the stored verdict for the same content within 24 hours (no new review)'),
  reviewed_at: z.string().nullable().describe('When it was reviewed (ISO 8601); null when nothing was stored'),
})
/** The review as create_ad states it (an unstored refusal has no creative and no date). */
const reviewOut = (v: ReviewView): z.infer<typeof REVIEW_OUT> => ({ ...v, status: v.status === 'approved' ? 'approved' : v.status === 'removed' ? 'removed' : 'refused' })

const n = (d: string) => z.number().describe(d)
const FIGURES_OUT = z.strictObject({
  ad_id: z.string().describe('The ad'),
  listing_id: z.string().nullable().describe('The advertised listing; null for a creative ad'),
  creative_id: z.string().nullable().describe('The creative it shows; null for a listing ad'),
  status: AD_STATUS_ANY.describe('As in list_ads: "active" when paid'),
  starts_at: z.string().nullable().describe('When it started or starts (ISO 8601)'),
  ends_at: z.string().nullable().describe('When it ends or ended (ISO 8601)'),
  totals: z.strictObject({
    impressions: n('Viewable impressions: at least half the card on screen for one second, once per browser session per 30 minutes'),
    clicks: n('Clicks and middle clicks on the card, once per browser session per 30 minutes'),
    invalid: n('Invalid traffic left out of the figures: bots, prefetches, events outside the run, the per-address cap'),
    ctr: z.number().nullable().describe('clicks ÷ impressions (0 to 1); null before any impression'),
    reach: n('Browser sessions that saw it, each once per UTC day'),
    frequency: z.number().nullable().describe('impressions ÷ reach; null before any reach'),
    currency: z.enum(['USDC', 'VND']).describe('What it was paid in: the money fields of the OTHER currency are null'),
    spend_usdc: z.string().nullable().describe('The price paid, pro rata to the part of the run that has elapsed, in USDC; null for an ad paid in VND'),
    paid_usdc: z.string().nullable().describe('The whole price paid, in USDC; null for an ad paid in VND'),
    ecpm_usdc: z.string().nullable().describe('Spend per 1,000 impressions, in USDC; null before any impression'),
    ecpc_usdc: z.string().nullable().describe('Spend per click, in USDC; null before any click'),
    spend_vnd: z.number().nullable().describe('The spend in đồng, for an ad paid by bank transfer; null for one paid in USDC'),
    paid_vnd: z.number().nullable().describe('The whole price paid in đồng; null for an ad paid in USDC'),
    ecpm_vnd: z.number().nullable().describe('Spend per 1,000 impressions, in đồng; null before any impression or in USDC'),
    ecpc_vnd: z.number().nullable().describe('Spend per click, in đồng; null before any click or in USDC'),
  }).describe('The whole run so far'),
  hourly: z.array(z.strictObject({
    hour_utc: z.string().describe('The hour, UTC (ISO 8601)'),
    hour_ict: z.string().describe('The same hour in Vietnam, such as "2026-11-25 15:00 ICT"'),
    impressions: n('Viewable impressions that hour'),
    clicks: n('Clicks that hour'),
    invalid: n('Invalid events that hour'),
    reach_new: n('Sessions seen for the first time that UTC day, in that hour'),
  })).describe('Hour by hour, oldest first; hours with no event are left out'),
  updated_at: z.string().describe('When these figures were read (ISO 8601): live to the last few seconds'),
})

const OFFER_OUT = z.strictObject({
  available: z.boolean().describe('Whether ads are on sale now; when false, promote_listing refuses and the price fields are null'),
  price_usdc: z.string().nullable().describe('The price of one week (168 hours) in USDC, as a decimal string such as "3.76"; null when not on sale'),
  price_usdc_per_hour: z.string().nullable().describe('The price of one hour in USDC, as a decimal string; an ad of any length costs this times its hours. Null when not on sale'),
  price_usdc_for_hours: z.string().nullable().describe('The price of the `hours` you passed (of a week when you passed none), in USDC: what promote_listing will ask to be paid. Null when not on sale'),
  min_hours: z.number().describe('The shortest ad you can buy, in hours'),
  max_hours: z.number().describe('The longest ad you can buy, in hours'),
  price_vnd_reference: z.number().describe('The weekly price in Vietnamese đồng, to tell a person in Vietnam what it costs; payment is in USDC only'),
  network: z.string().nullable().describe('Where it is paid: a CAIP-2 network id such as "eip155:8453" (Base); null when not on sale'),
  duration_days: z.number().describe('How many days an ad runs when promote_listing gets no `hours` (a week)'),
  placements: z.array(z.string()).describe('Where the ad is shown, one short sentence each: it comes first there, labelled "Ad"'),
  public_listings: z.number().describe('How many listings are public on the marketplace now: the pool the ad stands out from'),
  running_ads: z.number().describe('How many ads are running now; running ads take turns in the one ad slot'),
  creative_ads: z.strictObject({
    status: z.enum(['open', 'testing']).describe('"open": any shop can buy one with create_ad; "testing": a private test runs first, create_ad refuses until it opens'),
    note: z.string().nullable().describe('While testing, one sentence to pass on: when sales open; null when open'),
    placement: z.string().describe('Where your own ad (create_ad) shows, in one sentence'),
    max_hours: z.number().describe('The longest a creative ad runs, in hours'),
    refused: z.array(z.string()).describe('What the review refuses, one line per class: banned goods and services, and Art. 8 claims'),
    permit_classes_allowed: z.array(z.string()).describe('Classes that need a sector permit in Vietnam and are allowed; give permitRef when you have one'),
    policy_url: z.string().describe('The advertising policy, in English and Vietnamese'),
  }).describe('Your own ad in the feed card (create_ad): the spec, the rules and the policy'),
  listing: z.strictObject({
    id: z.string().describe('The listing you asked about'),
    eligible: z.boolean().describe('Whether promote_listing will accept it'),
    reason: z.string().nullable().describe('Why not, when it is not eligible; null when it is'),
  }).nullable().describe('The listing you passed as listingId, checked; null when you passed none'),
})

const LISTING_ID = z.string().describe('A live listing of this shop (list_listings)')
// A plain number, bounded by the server (adHours), as this server's other numeric inputs are: the reviewers flag schema bounds.
// Its prose says what to pass, never the bounds again: Manufact flagged "a whole number from 1 to 2160" as validation
// repeated (2026-11-24); get_ad_offer's `max_hours` states the longest.
const HOURS = z.number().optional().describe('Hours it runs; 168 if left out')

export const AD_TOOLS: McpTool[] = [
  {
    name: 'get_ad_offer',
    title: 'Get the ad offer',
    description: 'Price an ad: a listing first in results (promote_listing) or your own feed-card ad (create_ad). `listingId` checks a listing; `hours` prices it.\n\nReturns `price_usdc_for_hours`, `creative_ads`, `listing`.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    input: z.object({ listingId: LISTING_ID.optional(), hours: HOURS }),
    output: OFFER_OUT,
    handler: async (auth, args) => {
      const hours = adHours(args.hours)
      if (hours == null) throw new ToolError('invalid_input', `hours must be a whole number from 1 to ${AD_MAX_HOURS}.`)
      const cfg = x402Config()
      const offer = await adOffer(cfg)
      let listing: z.infer<typeof OFFER_OUT>['listing'] = null
      if (typeof args.listingId === 'string' && args.listingId) {
        const c = await checkAdListing(args.listingId, auth.sellerId)
        listing = { id: args.listingId, eligible: c.ok, reason: c.ok ? null : c.message }
      }
      return {
        available: offer.available,
        price_usdc: offer.price?.usdc ?? null,
        price_usdc_per_hour: cfg ? usdcText(adPriceAtomicFor(cfg, 1)) : null,
        price_usdc_for_hours: cfg ? usdcText(adPriceAtomicFor(cfg, hours)) : null,
        min_hours: 1,
        max_hours: AD_MAX_HOURS,
        price_vnd_reference: offer.price_vnd_reference,
        network: offer.price?.network ?? null,
        duration_days: offer.duration_days,
        placements: offer.placements.map((p) => p.text),
        public_listings: offer.audience.public_listings,
        running_ads: offer.audience.running_ads,
        creative_ads: {
          status: offer.creative_ads.status,
          note: offer.creative_ads.note,
          placement: offer.creative_ads.placement.text,
          max_hours: offer.creative_ads.placement.max_hours,
          refused: [...offer.creative_ads.restrictions.refused, ...offer.creative_ads.restrictions.claims_refused].map((r) => r.text),
          permit_classes_allowed: offer.creative_ads.restrictions.permit_classes_allowed.map((r) => r.class),
          policy_url: offer.creative_ads.policy_url,
        },
        listing,
      }
    },
  },
  {
    name: 'promote_listing',
    title: 'Buy an ad for a listing',
    description: 'Buy an ad for one of this shop\'s live listings in USDC over x402: the first call returns the payment request as an error; call again with the same arguments and `_meta["x402/payment"]`.\n\nReturns `ad` and `message`.',
    scope: 'listings:write',
    annotations: PAID_WRITE,
    input: z.object({ listingId: LISTING_ID, hours: HOURS }),
    output: z.strictObject({
      ad: AD_OUT.describe('The ad bought: its id, its status and when it runs'),
      message: z.string().nullable().describe('What to do next while the payment is still being confirmed, to pass on to the person; null once the ad is paid'),
    }),
    handler: async (auth, args, ctx) => {
      const cfg = x402Config()
      if (!cfg) throw new ToolError('ads_unavailable', 'Ads are not on sale right now.')
      const listingId = String(args.listingId || '').trim()
      const hours = adHours(args.hours)
      if (hours == null) throw new ToolError('invalid_input', `hours must be a whole number from 1 to ${AD_MAX_HOURS}.`)
      const payment = ctx?.meta?.[MCP_META_PAYMENT]
      if (payment === undefined) {
        // Check the listing BEFORE asking for money, so nobody signs a payment for an ad that would be refused.
        const c = await checkAdListing(listingId, auth.sellerId)
        if (!c.ok) throw new ToolError(c.code, c.message)
        throw new ToolPaymentRequired(adPaymentRequired(cfg, 'mcp', 'Payment required to buy this ad', hours))
      }
      const out = await bookAd({ cfg, keyId: auth.keyId, sellerId: auth.sellerId, listingId, rawPayload: payment, via: 'mcp', hours })
      switch (out.kind) {
        case 'booked':
          return new ToolResultWithMeta({ ad: { ...adView(out.ad), status: asAdStatus(AD_STATUS_ANY, out.ad.status) }, message: null }, { [MCP_META_RESPONSE]: out.settlement })
        case 'pending':
          return { ad: { ...adView(out.ad), status: asAdStatus(AD_STATUS_ANY, out.ad.status) }, message: PENDING_MESSAGE }
        case 'payment_invalid':
        case 'payment_failed':
          throw new ToolPaymentRequired(adPaymentRequired(cfg, 'mcp', bookFailureMessage(out), hours))
        case 'refused':
          throw new ToolError(out.code, out.message)
        case 'unavailable':
          throw new ToolError('payment_unavailable', out.message)
      }
    },
  },
  {
    name: 'create_ad',
    title: 'Create your own ad',
    description: 'Your own ad as the feed\'s first card, reviewed before payment: refused → `review` with reasons; approved → an x402 payment request; repeat it with `_meta["x402/payment"]`.\n\nReturns `review`, `ad`, `message`.',
    scope: 'ads:write',
    annotations: PAID_WRITE,
    // ⚠️ The ad's fields are ONE object whose properties carry no prose of their own: every word here is paid for in the
    // tools/list budget (tool-list-budget.test.ts). The limits are stated once, in the object's description.
    input: z.object({
      // Every field optional in the SCHEMA (the review names what is missing, review-reasons.ts): no `required` list to pay for.
      creative: z.object({
        advertiserName: z.string().describe('Name on the card, ≤40'),
        legalName: z.string().describe('Registered legal name'),
        taxCode: z.string().describe('MST or company no., optional'),
        headline: z.string().describe('≤60, any language'),
        body: z.string().describe('≤120, optional'),
        imageUrl: z.string().describe('https, ≥600 px, square'),
        clickUrl: z.string().describe('https landing page'),
        permitRef: z.string().describe('Permit no., optional'),
      }).partial().describe('The ad'),
      hours: HOURS,
    }),
    output: z.strictObject({
      review: REVIEW_OUT.describe('The review: approved, refused (with the reasons) or removed'),
      ad: AD_OUT.nullable().describe('The ad bought; null until it is paid, and when the review refused it'),
      message: z.string().nullable().describe('What to tell the person: why it was refused, or what to do while the payment is confirmed'),
    }),
    handler: async (auth, args, ctx) => {
      const cfg = x402Config()
      if (!cfg) throw new ToolError('ads_unavailable', 'Ads are not on sale right now.')
      const hours = adHours(args.hours === undefined ? AD_CREATIVE_MAX_HOURS : args.hours)
      if (hours == null || hours > AD_CREATIVE_MAX_HOURS) throw new ToolError('invalid_input', `hours must be a whole number from 1 to ${AD_CREATIVE_MAX_HOURS}.`)
      if (!auth.sellerId) throw new ToolError('shop_required', 'Ads are bought by a shop: connect with a shop account.')
      // ⛔ The private test (src/lib/ads/creative-gate.ts): an admin's only, before any review (no model call) or payment request.
      if (!(await creativeAdsAllowed(auth.profileId))) throw new ToolError(CREATIVE_ADS_NOT_OPEN.code, CREATIVE_ADS_NOT_OPEN.message)
      // The same fields again (the paid call) find the stored verdict: one review, never a second bill (creative-review.ts).
      const outcome = await reviewCreative(auth.sellerId, args.creative)
      if (outcome.kind === 'refused') {
        return { review: reviewOut(outcome.view), ad: null, message: `Not approved, so nothing to pay: ${outcome.view.reasons.map((r) => r.en).join(' ')} See ${AD_POLICY_URL}` }
      }
      if (outcome.kind !== 'approved') {
        if (outcome.kind === 'limited') throw new ToolError('review_limit', 'This shop has asked for too many ad reviews today. Try again tomorrow.')
        throw new ToolError('review_unavailable', 'The review could not run just now; nothing can be paid for. Try again in a few minutes.')
      }
      const review = reviewOut(outcome.view)
      const creativeId = outcome.creative.id
      const payment = ctx?.meta?.[MCP_META_PAYMENT]
      if (payment === undefined) throw new ToolPaymentRequired(adPaymentRequired(cfg, 'mcp', `Payment required to run approved ad creative ${creativeId} for ${hours} hours`, hours, 'creative'))
      const out = await bookAd({ cfg, keyId: auth.keyId, sellerId: auth.sellerId, profileId: auth.profileId, creativeId, rawPayload: payment, via: 'mcp', hours })
      switch (out.kind) {
        case 'booked':
          return new ToolResultWithMeta({ review, ad: { ...adView(out.ad), status: asAdStatus(AD_STATUS_ANY, out.ad.status) }, message: null }, { [MCP_META_RESPONSE]: out.settlement })
        case 'pending':
          return { review, ad: { ...adView(out.ad), status: asAdStatus(AD_STATUS_ANY, out.ad.status) }, message: PENDING_MESSAGE }
        case 'payment_invalid':
        case 'payment_failed':
          throw new ToolPaymentRequired(adPaymentRequired(cfg, 'mcp', bookFailureMessage(out), hours, 'creative'))
        case 'refused':
          throw new ToolError(out.code, out.message)
        case 'unavailable':
          throw new ToolError('payment_unavailable', out.message)
      }
    },
  },
  {
    name: 'get_ad_stats',
    title: 'Get ad figures',
    description: 'One ad\'s live figures: impressions, clicks, CTR, reach, spend, eCPM, eCPC, hourly.\n\nReturns `totals` and `hourly`.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    input: z.object({ adId: z.string().describe('From list_ads') }),
    output: FIGURES_OUT,
    handler: async (auth, args) => {
      const f = await shopAdFigures(String(args.adId || '').trim(), auth.sellerId)
      if (!f) throw new ToolError('not_found', 'Ad not found in this shop.')
      return { ...f, status: asAdStatus(AD_STATUS_ANY, f.status) }
    },
  },
  {
    name: 'list_ads',
    title: 'List this shop\'s ads',
    description: 'This shop\'s ads, newest first, with impressions and clicks.\n\nReturns `ads` (`id`, `listing_id`, `creative_id`, `status`, `impressions`, `clicks`).',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    input: z.object({}),
    output: z.strictObject({ ads: z.array(STATS_OUT).describe('The shop\'s ads, newest first (up to 50)') }),
    handler: async (auth) => ({ ads: auth.sellerId ? (await shopAds(auth.sellerId, 50, x402Config())).map((a) => ({ ...a, status: asAdStatus(AD_STATUS, a.status) })) : [] }),
  },
]

/** For copy that states the price (llms.txt, agents.md): "3.76 USDC" or null when not on sale. */
export function adPriceText(): string | null {
  const cfg = x402Config()
  return cfg ? `${usdcText(cfg.adPriceAtomic)} USDC` : null
}

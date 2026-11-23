import 'server-only'
import { z } from 'zod'
import { AD_MAX_HOURS, adHours, adPriceAtomicFor, x402Config, usdcText } from '@/lib/x402/config'
import { MCP_META_PAYMENT, MCP_META_RESPONSE } from '@/lib/x402/wire'
import { adOffer, adPaymentRequired } from '@/lib/ads/offer'
import { bookAd, checkAdListing, shopAds } from '@/lib/ads/book'
import { adView, bookFailureMessage, PENDING_MESSAGE } from '@/lib/ads/answer'
import { ToolError, ToolPaymentRequired, ToolResultWithMeta, type McpTool, type ToolAnnotations } from './tool-types'

/**
 * ── PAID ADS FOR AI AGENTS (owner 2026-11-23: "paid ad creation via mcp for ai agents to pay get our stats and post in
 * app an ad like normal product but labeled as ad … pay through x402"). Three tools on the signed-in shop server:
 *   get_ad_offer   — the price, the placements, the public audience figures, and whether a listing can be advertised;
 *   promote_listing — buys a 7-day ad for one of the shop's listings over x402 (specs/transports-v2/mcp.md): the first
 *                     call answers PaymentRequired as an error result; the same call with params._meta["x402/payment"]
 *                     pays, and its result carries _meta["x402/payment-response"];
 *   list_ads       — the shop's ads with impressions, taps and the listing's views and contacts during each ad.
 * The money path is src/lib/ads/book.ts, the same one POST /api/v1/ads takes.
 */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
// Spends money and changes what the public sees; never removes anything; a repeat with a NEW payment buys another week.
const PAID_WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }

const AD_OUT = z.strictObject({
  id: z.string().describe('The ad\'s id, as list_ads shows it'),
  listing_id: z.string().describe('The advertised listing'),
  status: z.string().describe('"active" (paid: shown between starts_at and ends_at), "pending" or "unknown" (payment sent, confirmation not yet found: it starts once found; call promote_listing again with the same payment to check)'),
  hours: z.number().describe('How many hours it runs, as bought'),
  starts_at: z.string().nullable().describe('When it starts being shown (ISO 8601); a second ad for the same listing starts when the first ends. Null until paid'),
  ends_at: z.string().nullable().describe('When it stops being shown (ISO 8601). Null until paid'),
  tx_hash: z.string().nullable().describe('The payment\'s transaction on the network; null until it is known'),
  network: z.string().describe('The payment network, as a CAIP-2 id (eip155:8453 is Base)'),
  amount_atomic: z.string().describe('The price paid, in the token\'s smallest unit (USDC has 6 decimals: 3760000 is 3.76 USDC)'),
})

const STATS_OUT = z.strictObject({
  id: z.string().describe('The ad\'s id'),
  listing_id: z.string().describe('The advertised listing'),
  status: z.string().describe('"active", "pending", "unknown" (see promote_listing) or "review" (being checked by hand)'),
  hours: z.number().describe('How many hours it runs, as bought'),
  starts_at: z.string().nullable().describe('When it started or starts (ISO 8601); null until paid'),
  ends_at: z.string().nullable().describe('When it ends or ended (ISO 8601); null until paid'),
  impressions: z.number().describe('Times the ad card was at least half on screen for a second, during its run (at most once per visitor per 10 minutes)'),
  clicks: z.number().describe('Taps on the ad card during its run (same limit)'),
  listing_views: z.number().nullable().describe('The listing\'s page views from the day the ad started (to its end, or now): from daily snapshots, so ad and non-ad visits together. Null when not measurable yet, and always for an ad shorter than a day'),
  listing_contacts: z.number().nullable().describe('Signed-in buyers who opened the seller\'s contact over the same days; null when not measurable yet'),
  amount_usdc_atomic: z.string().describe('The price paid, in USDC\'s smallest unit (6 decimals)'),
  network: z.string().describe('The payment network (CAIP-2)'),
  tx_hash: z.string().nullable().describe('The payment\'s transaction; null until known'),
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
  listing: z.strictObject({
    id: z.string().describe('The listing you asked about'),
    eligible: z.boolean().describe('Whether promote_listing will accept it'),
    reason: z.string().nullable().describe('Why not, when it is not eligible; null when it is'),
  }).nullable().describe('The listing you passed as listingId, checked; null when you passed none'),
})

const LISTING_ID = z.string().describe('The id of one of this shop\'s live listings, from list_listings')
// A plain number, bounded by the server (adHours), as this server's other numeric inputs are: the reviewers flag schema bounds.
// Its prose says what to pass, never the bounds again: Manufact flagged "a whole number from 1 to 2160" as validation
// repeated (2026-11-24); get_ad_offer's `max_hours` states the longest.
const HOURS = z.number().optional().describe('How long the ad should run, in hours: 24 for a day, 168 for a week, 720 for thirty days, or 1 to try it out. Leave it out for a week. It is priced pro rata from the weekly price; get_ad_offer prices any length before you buy')

export const AD_TOOLS: McpTool[] = [
  {
    name: 'get_ad_offer',
    title: 'Get the ad offer',
    description: 'Read what a paid ad on this marketplace costs and where it shows, before buying one with promote_listing. An ad puts one of this shop\'s live listings first, labelled "Ad / Quảng cáo", in matching search and category results, the home feed and the similar-listings row, for as many whole hours as you choose (1 hour up to 90 days; a week by default), priced pro rata. Pass `listingId` to check that listing can be advertised, and `hours` to price that length.\n\nReturns `available`, `price_usdc` (a week), `price_usdc_per_hour`, `price_usdc_for_hours`, `min_hours`, `max_hours`, `price_vnd_reference`, `network`, `duration_days`, `placements`, `public_listings`, `running_ads` and `listing` (`id`, `eligible`, `reason`).',
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
        listing,
      }
    },
  },
  {
    name: 'promote_listing',
    title: 'Buy an ad for a listing',
    description: 'Buy an ad for one of this shop\'s live listings for `hours` (1 hour up to 90 days; a week when left out), paid in USDC over x402, priced pro rata from the weekly price. The first call returns the payment request (an error result holding the x402 PaymentRequired: price, network, recipient); sign it with an x402 client and call again with the same `listingId` and `hours` and the payment in `_meta["x402/payment"]`. Check the listing and the price with get_ad_offer first. A second ad for the same listing starts when the first ends.\n\nReturns `ad` (`id`, `listing_id`, `status`, `hours`, `starts_at`, `ends_at`, `tx_hash`, `network`, `amount_atomic`) and `message`; the paid result also carries `_meta["x402/payment-response"]`.',
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
          return new ToolResultWithMeta({ ad: adView(out.ad), message: null }, { [MCP_META_RESPONSE]: out.settlement })
        case 'pending':
          return { ad: adView(out.ad), message: PENDING_MESSAGE }
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
    name: 'list_ads',
    title: 'List this shop\'s ads',
    description: 'List this shop\'s ads, newest first, with what each has done: impressions and taps on the ad card during its run, and the listing\'s own views and contacts over the ad\'s days. Ads whose payment was refused are not listed.\n\nReturns `ads`, each with `id`, `listing_id`, `status`, `hours`, `starts_at`, `ends_at`, `impressions`, `clicks`, `listing_views`, `listing_contacts`, `amount_usdc_atomic`, `network` and `tx_hash`.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    input: z.object({}),
    output: z.strictObject({ ads: z.array(STATS_OUT).describe('The shop\'s ads, newest first (up to 50)') }),
    handler: async (auth) => ({ ads: auth.sellerId ? await shopAds(auth.sellerId, 50, x402Config()) : [] }),
  },
]

/** For copy that states the price (llms.txt, agents.md): "3.76 USDC" or null when not on sale. */
export function adPriceText(): string | null {
  const cfg = x402Config()
  return cfg ? `${usdcText(cfg.adPriceAtomic)} USDC` : null
}

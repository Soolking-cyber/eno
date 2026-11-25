import 'server-only'
import { db } from '@/lib/db'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { AD_DAYS, AD_MAX_HOURS, AD_PRICE_VND, AD_WEEK_HOURS, adPriceAtomicFor, adRequirements, usdcText, type X402Config } from '@/lib/x402/config'
import { X402_VERSION, type PaymentRequired } from '@/lib/x402/wire'
import { logError } from '@/lib/log'
import { AD_FIELD_LIMITS, AD_IMAGE_ASPECT, AD_IMAGE_MAX_BYTES, AD_IMAGE_MIN_EDGE } from './creative-review'
import { AD_CREATIVE_MAX_HOURS } from './book'
import { AD_QUESTIONS, AD_QUESTION_KEYS, PERMIT_CLASSES } from './review-jev'
import { REVIEW_REASONS } from './review-reasons'

/**
 * ── The ad offer, as x402 states it (PaymentRequired) and as a plain answer (GET /api/v1/ads/offer, MCP get_ad_offer).
 * The PaymentRequired carries the x402 Bazaar discovery extension (specs/extensions/bazaar.md): Coinbase's facilitator
 * indexes the offer after its first settlement, so buyer agents searching the Bazaar / Agentic.Market find it.
 * ⛔ Bazaar content policy: the description DESCRIBES the endpoint, it never instructs an agent; ≤ 500 characters;
 * serviceName ≤ 32 printable ASCII; ≤ 5 tags; a PNG icon.
 */
export const SITE_ORIGIN = new URL(OAUTH_ISSUER).origin
export const AD_RESOURCE_URL = `${SITE_ORIGIN}/api/v1/ads`
export const MCP_URL = `${SITE_ORIGIN}/api/mcp`
export const AD_POLICY_URL = `${SITE_ORIGIN}/advertising-policy`
/** The approved creative's id on its 402 (POST /api/v1/ads): the x402 body stays exactly the PaymentRequired. */
export const HEADER_CREATIVE_ID = 'Eno-Ad-Creative-Id'
/** The card's disclosure: ONE word, in the viewer's own language (owner 2026-11-25: "just quang cao or ad … in their respected
 *  language no need for both") — the listing ads' own tr('Ad', 'Quảng cáo'); other languages get the app's translation of it. */
export const AD_LABEL = { en: 'Ad', vi: 'Quảng cáo', shown: "one word, in the viewer's language" } as const
/**
 * ── THE ONE STANDARD PLACEMENT FOR ANY ADVERTISER (owner 2026-11-25: "have to have standardized places where they show
 * up"): the feed card — the first card on page 1 of the home feed, category and search results, in the grid view. The
 * spec every surface states (GET /api/v1/ads/offer, MCP get_ad_offer, /advertising-policy) comes from these numbers, the
 * ones the review enforces (creative-review.ts).
 */
export const FEED_CARD_PLACEMENT = {
  id: 'feed_card',
  text: 'The first card on page 1 of the home feed, category and search results (grid view), the same size as the listing cards around it.',
  label: AD_LABEL,
  image: { min_px: AD_IMAGE_MIN_EDGE, aspect_min: AD_IMAGE_ASPECT.min, aspect_max: AD_IMAGE_ASPECT.max, max_bytes: AD_IMAGE_MAX_BYTES, formats: ['image/jpeg', 'image/png', 'image/webp'], shown: 'square, cropped to fill' },
  headline_max: AD_FIELD_LIMITS.headline,
  body_max: AD_FIELD_LIMITS.body,
  advertiser_name_max: AD_FIELD_LIMITS.advertiserName,
  languages: 'Any. Each viewer reads the headline and text in their own language (machine translation, cached); the advertiser name and the picture are shown as they are.',
  landing: 'Your own https page. The whole card is one link to it, opened in a new tab (rel="sponsored").',
  max_hours: AD_CREATIVE_MAX_HOURS,
} as const

/** What the review refuses and what it allows (review-jev.ts), as plain words: one line per class. */
export function adRestrictions() {
  const sentence = (k: (typeof AD_QUESTION_KEYS)[number]) => {
    const q = AD_QUESTIONS[k] as { refusal?: keyof typeof REVIEW_REASONS }
    return q.refusal ? REVIEW_REASONS[q.refusal].en : AD_QUESTIONS[k].instructions.replace(/^This ad promotes /, '').replace(/\.$/, '')
  }
  return {
    refused: AD_QUESTION_KEYS.filter((k) => AD_QUESTIONS[k].family === 'banned').map((k) => ({ class: k, text: sentence(k) })),
    claims_refused: AD_QUESTION_KEYS.filter((k) => AD_QUESTIONS[k].family === 'claim').map((k) => ({ class: k, text: sentence(k) })),
    // ⛔ Allowed since 2026-11-25 (owner: "permit categories are now allowed"); recorded on the creative, never refused.
    permit_classes_allowed: PERMIT_CLASSES.map((k) => ({ class: k, text: sentence(k) })),
    permit_ref: `Optional (≤ ${AD_FIELD_LIMITS.permitRef} characters): for a permit class, your ad-content confirmation or licence number. Recorded with the ad and shown to eno's reviewers.`,
  }
}

export const AD_PLACEMENTS = [
  { id: 'search', text: 'first in matching search and category results' },
  { id: 'home', text: 'first in the home page feed' },
  { id: 'similar', text: 'first in the similar-listings row on listing pages' },
] as const

const DESCRIPTION =
  `A paid placement on eno.vn (Vietnam's marketplace for expats) for 1 to ${AD_MAX_HOURS} hours, priced pro rata from a ` +
  'weekly price: one of your shop\'s live listings shown first, labelled "Ad", in matching results, the home feed and ' +
  'similar listings (scope listings:write), or your own ad (a picture, a headline and your https page) in the feed card ' +
  `for up to ${AD_CREATIVE_MAX_HOURS} hours, reviewed before any payment (scope ads:write). Requires a signed-in eno.vn shop.`

const LISTING_ID_SCHEMA = { type: 'string', description: 'The id of one of your live listings (list_listings or GET /api/v1/listings)', minLength: 1, maxLength: 64 }
const HOURS_SCHEMA = { type: 'integer', minimum: 1, maximum: AD_MAX_HOURS, description: `How many hours the ad runs: 1 (a cheap way to try it), 24 a day, 168 a week (default), 720 thirty days; the price is the weekly price pro rata` }
const OUTPUT_EXAMPLE = { ad: { id: 'cmabc123', listing_id: 'cmlisting1', status: 'active', starts_at: '2026-11-23T08:00:00.000Z', ends_at: '2026-11-30T08:00:00.000Z' } }

/** The discovery entry, its example body the SAME length the offer beside it is priced for. */
function bazaar(transport: 'http' | 'mcp', hours: number) {
  if (transport === 'mcp') {
    return {
      info: {
        input: {
          type: 'mcp',
          toolName: 'promote_listing',
          transport: 'streamable-http',
          description: DESCRIPTION,
          inputSchema: { type: 'object', properties: { listingId: LISTING_ID_SCHEMA, hours: HOURS_SCHEMA }, required: ['listingId'], additionalProperties: false },
          example: { listingId: 'cmlisting1', hours },
        },
        output: { type: 'json', example: OUTPUT_EXAMPLE },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'mcp' },
              toolName: { type: 'string', const: 'promote_listing' },
              transport: { type: 'string', enum: ['streamable-http'] },
              description: { type: 'string' },
              inputSchema: { type: 'object' },
              example: { type: 'object' },
            },
            required: ['type', 'toolName', 'inputSchema'],
          },
          output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
        },
        required: ['input'],
      },
    }
  }
  return {
    info: {
      input: { type: 'http', method: 'POST', bodyType: 'json', body: { listingId: 'cmlisting1', hours } },
      output: { type: 'json', example: OUTPUT_EXAMPLE },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['POST'] },
            bodyType: { type: 'string', enum: ['json'] },
            body: { type: 'object', properties: { listingId: LISTING_ID_SCHEMA, hours: HOURS_SCHEMA }, required: ['listingId'], additionalProperties: false },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
          },
          required: ['type', 'method', 'bodyType', 'body'],
          additionalProperties: false,
        },
        output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
      },
      required: ['input'],
    },
  }
}

/** `kind: 'creative'` (an approved creative's 402) carries no Bazaar entry: discovery describes the listing call, which a
 *  client can make in one go; a creative needs its review first. */
export function adPaymentRequired(cfg: X402Config, transport: 'http' | 'mcp', error?: string, hours: number = AD_WEEK_HOURS, kind: 'listing' | 'creative' = 'listing'): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource: {
      url: transport === 'mcp' ? MCP_URL : AD_RESOURCE_URL,
      description: DESCRIPTION,
      mimeType: 'application/json',
      serviceName: 'eno.vn ads',
      tags: ['advertising', 'marketplace', 'classifieds', 'vietnam'],
      iconUrl: `${SITE_ORIGIN}/icon-512.png`,
    },
    accepts: [adRequirements(cfg, hours)],
    ...(kind === 'listing' ? { extensions: { bazaar: bazaar(transport, hours) } } : {}),
  }
}

/** Public figures an agent can weigh the offer by: live listings per category and the ads running now. Cached 1 h. */
let audienceCache: { at: number; value: AdAudience } | null = null
export type AdAudience = { public_listings: number; by_category: { category: string; listings: number }[]; running_ads: number }

export async function adAudience(now = Date.now()): Promise<AdAudience> {
  if (audienceCache && now - audienceCache.at < 3_600_000) return audienceCache.value
  const { where } = await buildFeedFilters(new URLSearchParams())
  const [groups, cats, running] = await Promise.all([
    // edition-lint-allow: `where` is buildFeedFilters' own, which already ANDs marketplaceListingScope() (feed-query.ts).
    db.listing.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    db.category.findMany({ select: { id: true, slug: true } }),
    // Fail-soft: 0 before scripts/listing-ad-ddl.mjs has run.
    db.listingAd.count({ where: { status: 'active', startsAt: { lte: new Date(now) }, endsAt: { gt: new Date(now) } } }).catch((e: unknown) => { logError(e, { op: 'ads.audience' }); return 0 }),
  ])
  const slug = new Map(cats.map((c) => [c.id, c.slug]))
  const by = groups.map((g) => ({ category: slug.get(g.categoryId) ?? g.categoryId, listings: g._count._all })).sort((a, b) => b.listings - a.listings)
  const value = { public_listings: by.reduce((n, c) => n + c.listings, 0), by_category: by, running_ads: running }
  audienceCache = { at: now, value }
  return value
}

export type AdOffer = {
  available: boolean
  price: { usdc: string; amount_atomic: string; asset: string; network: string; network_name: string; pay_to: string } | null
  /** Sample lengths with their price (any whole number of hours from 1 to max_hours is sold, pro rata). */
  prices: { hours: number; label: string; usdc: string; amount_atomic: string }[]
  min_hours: number
  max_hours: number
  price_vnd_reference: number
  duration_days: number
  placements: { id: string; text: string }[]
  label: string
  requires: string
  how_to_buy: { http: string; mcp: string }
  /** Any lawful advertiser (2026-11-25): the one standard placement, what is refused, and the review-then-pay flow. */
  creative_ads: {
    placement: typeof FEED_CARD_PLACEMENT
    restrictions: ReturnType<typeof adRestrictions>
    requires: string
    flow: { http: string[]; mcp: string }
    charged: string
    policy_url: string
  }
  audience: AdAudience
}

export async function adOffer(cfg: X402Config | null): Promise<AdOffer> {
  const r = cfg ? adRequirements(cfg) : null
  return {
    available: !!cfg,
    price: cfg && r ? { usdc: usdcText(r.amount), amount_atomic: r.amount, asset: r.asset, network: r.network, network_name: cfg.networkLabel, pay_to: r.payTo } : null,
    prices: cfg ? ([[1, '1 hour'], [24, '1 day'], [AD_WEEK_HOURS, '7 days'], [720, '30 days']] as const).map(([h, label]) => {
      const a = adPriceAtomicFor(cfg, h)
      return { hours: h, label, usdc: usdcText(a), amount_atomic: a }
    }) : [],
    min_hours: 1,
    max_hours: AD_MAX_HOURS,
    price_vnd_reference: AD_PRICE_VND,
    duration_days: AD_DAYS,
    placements: AD_PLACEMENTS.map((p) => ({ ...p })),
    label: 'Ad / Quảng cáo',
    requires: 'A signed-in eno.vn shop (OAuth sign-in or an API key) with scope listings:write; the listing must be yours and live.',
    how_to_buy: {
      http: `POST ${AD_RESOURCE_URL} with {"listingId": "…", "hours": 1 to ${AD_MAX_HOURS}}: the first answer is 402 with PAYMENT-REQUIRED (x402 v2, scheme exact, USDC); repeat it with PAYMENT-SIGNATURE and your Bearer token.`,
      mcp: `promote_listing on ${MCP_URL} (listingId, hours 1 to ${AD_MAX_HOURS}): the first result asks for payment (x402 MCP transport); call it again with _meta["x402/payment"].`,
    },
    creative_ads: {
      placement: FEED_CARD_PLACEMENT,
      restrictions: adRestrictions(),
      requires: 'A signed-in eno.vn shop with scope ads:write (never granted by default: ask for it), and the advertiser\'s registered legal name and tax code (MST).',
      flow: {
        http: [
          `1. Review: POST ${AD_RESOURCE_URL} with {"creative": {"advertiserName", "legalName", "taxCode", "headline", "body"?, "imageUrl", "clickUrl", "permitRef"?}, "hours": 1 to ${AD_CREATIVE_MAX_HOURS}} and your Bearer token. eno checks it before any price is offered.`,
          '2. Refused: 422 with `review.reasons` (a code and an English and Vietnamese sentence each); nothing to pay. Change the ad and submit it again.',
          '3. Approved: 402 with PAYMENT-REQUIRED (x402 v2) and the creative id in Eno-Ad-Creative-Id. Repeat the same request (or {"creativeId", "hours"}) with PAYMENT-SIGNATURE to pay; it runs from the moment the payment settles.',
        ],
        mcp: `create_ad on ${MCP_URL}: the same review, then the x402 payment request; call it again with _meta["x402/payment"]. get_ad_stats reads its figures.`,
      },
      charged: 'Charged when the payment settles, then the ad runs. eno may remove an ad that breaks the law or this policy; a removal is refunded pro rata on request.',
      policy_url: AD_POLICY_URL,
    },
    audience: await adAudience(),
  }
}

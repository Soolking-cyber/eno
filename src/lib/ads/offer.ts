import 'server-only'
import { db } from '@/lib/db'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { AD_DAYS, AD_PRICE_VND, adRequirements, usdcText, type X402Config } from '@/lib/x402/config'
import { X402_VERSION, type PaymentRequired } from '@/lib/x402/wire'
import { logError } from '@/lib/log'

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
export const AD_PLACEMENTS = [
  { id: 'search', text: 'first in matching search and category results' },
  { id: 'home', text: 'first in the home page feed' },
  { id: 'similar', text: 'first in the similar-listings row on listing pages' },
] as const

const DESCRIPTION =
  `A ${AD_DAYS}-day paid placement for one listing of your eno.vn shop (eno.vn: Vietnam's marketplace for expats). ` +
  'The listing is shown first, labelled "Ad", in matching search and category results, the home feed and the ' +
  'similar-listings row. Requires a signed-in eno.vn shop (Bearer token with scope listings:write); the listing must be ' +
  'yours and live. Two purchases for one listing run back to back.'

const LISTING_ID_SCHEMA = { type: 'string', description: 'The id of one of your live listings (list_listings or GET /api/v1/listings)', minLength: 1, maxLength: 64 }
const OUTPUT_EXAMPLE = { ad: { id: 'cmabc123', listing_id: 'cmlisting1', status: 'active', starts_at: '2026-11-23T08:00:00.000Z', ends_at: '2026-11-30T08:00:00.000Z' } }

function bazaar(transport: 'http' | 'mcp') {
  if (transport === 'mcp') {
    return {
      info: {
        input: {
          type: 'mcp',
          toolName: 'promote_listing',
          transport: 'streamable-http',
          description: DESCRIPTION,
          inputSchema: { type: 'object', properties: { listingId: LISTING_ID_SCHEMA }, required: ['listingId'], additionalProperties: false },
          example: { listingId: 'cmlisting1' },
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
      input: { type: 'http', method: 'POST', bodyType: 'json', body: { listingId: 'cmlisting1' } },
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
            body: { type: 'object', properties: { listingId: LISTING_ID_SCHEMA }, required: ['listingId'], additionalProperties: false },
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

export function adPaymentRequired(cfg: X402Config, transport: 'http' | 'mcp', error?: string): PaymentRequired {
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
    accepts: [adRequirements(cfg)],
    extensions: { bazaar: bazaar(transport) },
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
  price_vnd_reference: number
  duration_days: number
  placements: { id: string; text: string }[]
  label: string
  requires: string
  how_to_buy: { http: string; mcp: string }
  audience: AdAudience
}

export async function adOffer(cfg: X402Config | null): Promise<AdOffer> {
  const r = cfg ? adRequirements(cfg) : null
  return {
    available: !!cfg,
    price: cfg && r ? { usdc: usdcText(r.amount), amount_atomic: r.amount, asset: r.asset, network: r.network, network_name: cfg.networkLabel, pay_to: r.payTo } : null,
    price_vnd_reference: AD_PRICE_VND,
    duration_days: AD_DAYS,
    placements: AD_PLACEMENTS.map((p) => ({ ...p })),
    label: 'Ad / Quảng cáo',
    requires: 'A signed-in eno.vn shop (OAuth sign-in or an API key) with scope listings:write; the listing must be yours and live.',
    how_to_buy: {
      http: `POST ${AD_RESOURCE_URL} with {"listingId": "…"}: the first answer is 402 with PAYMENT-REQUIRED (x402 v2, scheme exact, USDC); repeat it with PAYMENT-SIGNATURE and your Bearer token.`,
      mcp: `promote_listing on ${MCP_URL}: the first result asks for payment (x402 MCP transport); call it again with _meta["x402/payment"].`,
    },
    audience: await adAudience(),
  }
}

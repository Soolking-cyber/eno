import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { LISTING_FEED_SELECT, serializeFeedListing } from '@/lib/serialize'
import { feedCategories, feedListingTypes, FEED_EXCLUDED_PRICE_UNITS } from '@/lib/product-feed'
import { chatgptFeedItem } from '@/lib/chatgpt-feed'
import { logError } from '@/lib/log'

function feedResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/jsonl; charset=utf-8',
      'Content-Disposition': 'inline; filename="eno-chatgpt-products.jsonl"',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * ── GET /api/feeds/chatgpt — eno's product feed for ChatGPT (Business Hub › Products › hosted URL; owner 2026-11-24).
 * JSON Lines in OpenAI's product feed schema (src/lib/chatgpt-feed.ts maps each row). The selection is the Google
 * Shopping feed's, clause for clause (src/app/api/feeds/google-shopping/route.ts says why each one is there), plus the
 * shop's public name and id for seller_name / seller_url — never its phone or email.
 * ⚠️ OPEN, UNLIKE THE GOOGLE AND META FEEDS: OpenAI's hosted-URL fetch takes no credentials ("Product and image URLs must
 * be publicly accessible"), and every row is a public listing page already. The built body is kept an hour per process
 * (below), so an open endpoint never turns into a full-catalogue read per request.
 */
// ⛔ THE BUILT FEED IS KEPT FOR AN HOUR PER PROCESS: the endpoint is open, and the query reads the whole catalogue — a
// caller hammering it gets the same body, not a new full-table read each time. ChatGPT re-reads it rarely.
const BODY_TTL_MS = 3_600_000
const bodies = new Map<string, { at: number; body: string }>()
/** One build in flight per variant: parallel cold requests share it instead of each reading the whole catalogue. */
const building = new Map<string, Promise<string>>()

async function buildBody(excludeMock: boolean): Promise<string> {
  const listings = await db.listing.findMany({
    where: await scopedListingWhere({
      verified: true,
      status: 'active',
      affiliateUrl: null,
      listingType: { in: feedListingTypes() },
      category: { slug: { in: feedCategories() } },
      priceUnit: { notIn: [...FEED_EXCLUDED_PRICE_UNITS] },
    }),
    select: { ...LISTING_FEED_SELECT, seller: { select: { id: true, name: true } } },
    orderBy: { postedAt: 'desc' },
  })
  const brandSlugs = Array.from(new Set(listings.map((l) => l.brandSlug).filter(Boolean))) as string[]
  const brandRows = brandSlugs.length ? await db.brand.findMany({ where: { slug: { in: brandSlugs } }, select: { slug: true, name: true } }) : []
  const brandName = new Map(brandRows.map((b) => [b.slug, b.name]))
  const host = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  const lines: string[] = []
  const withheld: Record<string, number> = {}
  for (const l of listings) {
    // One bad row is withheld, never the whole catalogue.
    try {
      const row = { ...serializeFeedListing(l), seller: l.seller }
      const out = chatgptFeedItem(row, { host, brandName: l.brandSlug ? brandName.get(l.brandSlug) ?? null : null, excludeMock })
      if ('withheld' in out) { withheld[out.withheld] = (withheld[out.withheld] ?? 0) + 1; continue }
      lines.push(JSON.stringify(out.item))
    } catch {
      withheld.row_error = (withheld.row_error ?? 0) + 1
    }
  }
  if (Object.keys(withheld).length) console.info('chatgpt-feed: withheld %o of %d eligible rows', withheld, listings.length)
  return lines.join('\n') + (lines.length ? '\n' : '')
}

export async function GET(req: Request) {
  try {
    // Placeholder (seed) images are left out unless explicitly asked for (?exclude_mock=0).
    const excludeMock = new URL(req.url).searchParams.get('exclude_mock') !== '0'
    const key = excludeMock ? 'clean' : 'all'
    const hit = bodies.get(key)
    if (hit && Date.now() - hit.at < BODY_TTL_MS) return feedResponse(hit.body)
    let inflight = building.get(key)
    if (!inflight) {
      inflight = buildBody(excludeMock).finally(() => building.delete(key))
      building.set(key, inflight)
    }
    const body = await inflight
    bodies.set(key, { at: Date.now(), body })
    return feedResponse(body)
  } catch (e) {
    logError(e, { op: 'feeds.chatgpt' })
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

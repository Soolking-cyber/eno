import 'server-only'
import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { LISTING_FEED_SELECT, serializeFeedListing } from '@/lib/serialize'
import { feedCategories, feedListingTypes, FEED_EXCLUDED_PRICE_UNITS } from '@/lib/product-feed'
import { chatgptFeedItem } from '@/lib/chatgpt-feed'

/**
 * The ChatGPT product feed's body, built once and shared by its two addresses (owner 2026-11-24): /api/feeds/chatgpt
 * (plain JSON Lines, for a look) and /api/feeds/chatgpt.jsonl.gz (gzipped — the form ChatGPT's hosted-URL fetch accepts:
 * .parquet, .jsonl.gz, .csv.gz or .tsv.gz). The selection and every rule: src/lib/chatgpt-feed.ts and the route.
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


/** The feed body for `excludeMock`, from the hour-long cache or one shared build. */
export async function chatgptFeedBody(excludeMock: boolean): Promise<string> {
  const key = excludeMock ? 'clean' : 'all'
  const hit = bodies.get(key)
  if (hit && Date.now() - hit.at < BODY_TTL_MS) return hit.body
  let inflight = building.get(key)
  if (!inflight) {
    inflight = buildBody(excludeMock).finally(() => building.delete(key))
    building.set(key, inflight)
  }
  const body = await inflight
  bodies.set(key, { at: Date.now(), body })
  return body
}

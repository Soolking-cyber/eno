import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { FALLBACK_BRAND_KEY, fallbackBandKey, fallbackFacetFor } from '@/lib/price-fallback'
import { getPriceBand, SALE_LISTING_TYPE } from '@/lib/price-stat'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

const EMPTY = { n: 0 }

// Price guidance for the post wizard — the SAME PriceStat band the PDP's "Market
// price" module shows (getPriceBand owns the segment formula + the n≥5 / max-spread
// suppression, so the seller and the buyer are always judged against one band).
// Accepts `brandSlug` directly, or a raw `brand` name resolved READ-ONLY by its
// normalized key — never resolveBrand() here, which grows the catalogue and would
// mint a brand row per keystroke. Public aggregated data; { n: 0 } means "no
// reliable band" and the client shows nothing.
//
// THE FALLBACK FLOWS THROUGH HERE TOO (src/lib/price-fallback.ts): when the brand+model band has no
// data — or no brand/model was given at all, the case of a sofa or a cot — getPriceBand answers with
// the shelf's similar-items band, marked `basis: 'similar'`. A facet shelf needs the facet's value,
// sent as `attr_<key>` (the feed's own parameter shape; fallbackFacetFor() names the key); only that
// one key is read.
//
// ⚠️ WS6 — NOT MIGRATED: like the rest of this route's error handling, being rate-limited is answered
// with `200 {"n":0}`, not `429 {"error":"rate_limited"}` — guidance is a bonus and every failure hides
// it rather than surfacing an error in the post wizard. The wrapper's `rateLimit:` option can only
// emit the 429, and it would additionally run BEFORE the early-outs below, spending a typist's
// budget on requests that never touch the DB. Public and no JSON body, so with the limiter pinned in
// place all four options are empty.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const model = (p.get('model') || '').trim().slice(0, 80)
  let brandSlug = (p.get('brandSlug') || '').trim().slice(0, 60)
  const brandRaw = (p.get('brand') || '').trim().slice(0, 60)
  // The band is per SHELF since 2026-09-15 (see listingSegment): a seller pricing a case is coached
  // against cases, not the phone it fits. No subcategory chosen yet → no guidance, same as the PDP.
  const categorySlug = (p.get('category') || '').trim().slice(0, 60) || null
  const subcategorySlug = (p.get('subcategory') || '').trim().slice(0, 60) || null
  if (!categorySlug || !subcategorySlug) return NextResponse.json(EMPTY)
  const wantsModel = !!model && !!(brandSlug || brandRaw)
  // undefined = this shelf has no fallback band; null = the shelf alone; a string = the facet key,
  // whose value arrives as attr_<key> (only that one key is read).
  const facet = fallbackFacetFor(categorySlug, subcategorySlug)
  const facetValue = facet ? (p.get(`attr_${facet}`) || '').trim().slice(0, 40) : ''
  const attributes = facet && facetValue ? { [facet]: facetValue } : null
  // Nothing either band could answer — no brand+model asked for, and no fallback key (an unlisted shelf,
  // or a facet shelf without a taxonomy value) → no DB, and no rate-limit budget spent.
  if (!wantsModel && !fallbackBandKey({ categorySlug, subcategorySlug, attributes })) return NextResponse.json(EMPTY)

  // Debounced typeahead-style caller → IP throttle to bound DB amplification.
  const ip = clientIp(req)
  const rl = await rateLimit('price-guidance', ip, 60, '1 m')
  if (!rl.success) return NextResponse.json(EMPTY)

  const condition = (p.get('condition') || '').trim() || null
  const yearNum = Number.parseInt(p.get('year') || '', 10)
  const year = Number.isFinite(yearNum) ? yearNum : null
  const listingType = (p.get('type') || '').trim().slice(0, 20) || SALE_LISTING_TYPE

  try {
    let bandModel: string | null = null
    if (wantsModel) {
      // An unknown or too-short brand no longer ends the request: it only means there is no
      // brand+model band to find, and the fallback still answers.
      if (!brandSlug) {
        const norm = normalizeBrand(brandRaw)
        const hit = norm.length >= 2 ? await db.brand.findUnique({ where: { normalized: norm }, select: { slug: true } }) : null
        brandSlug = hit?.slug ?? ''
      }
      if (brandSlug && brandSlug !== FALLBACK_BRAND_KEY) {
        // Free-typed model: resolve the canonical casing case-insensitively so
        // "wave alpha" still hits the "Wave Alpha" stat rows. The shared getPriceBand
        // stays exact-match — identical to the PDP path by project rule.
        const canonical = await db.$queryRaw<{ model: string }[]>`
          SELECT model FROM "PriceStat"
          WHERE "brandSlug" = ${brandSlug} AND lower(model) = lower(${model})
          LIMIT 1`
        bandModel = canonical[0]?.model ?? model
      }
    }
    // ⚠️ THE CALLER'S OWN INTENT, NOT A HARDCODED 'sell'. The bands are sale prices, and the reader
    // refuses anything else — but hardcoding the sale type HERE would have handed sale guidance to a
    // rental seller the day a branded category offers renting, which is the guard defeating itself
    // (astra). Absent → 'sell', which is what a wizard that never sends it is writing.
    const band = await getPriceBand({
      brandSlug: bandModel ? brandSlug : null,
      model: bandModel,
      categorySlug,
      subcategorySlug,
      listingType,
      condition,
      year,
      attributes,
    })
    return NextResponse.json(
      band ?? EMPTY,
      // Aggregated public stats refreshed by a daily cron → safe to let the CDN
      // absorb repeat lookups (popular brand+model pairs), same policy as suggest.
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json(EMPTY) // guidance is a bonus — any failure just hides it
  }
}

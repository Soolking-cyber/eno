import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { getPriceBand } from '@/lib/price-stat'
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
// ⚠️ WS6 — NOT MIGRATED: like the rest of this route's error handling, being rate-limited is answered
// with `200 {"n":0}`, not `429 {"error":"rate_limited"}` — guidance is a bonus and every failure hides
// it rather than surfacing an error in the post wizard. The wrapper's `rateLimit:` option can only
// emit the 429, and it would additionally run BEFORE the `!model` early-out, spending a typist's
// budget on requests that never touch the DB. Public and no JSON body, so with the limiter pinned in
// place all four options are empty.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const model = (p.get('model') || '').trim().slice(0, 80)
  let brandSlug = (p.get('brandSlug') || '').trim().slice(0, 60)
  const brandRaw = (p.get('brand') || '').trim().slice(0, 60)
  if (!model || (!brandSlug && !brandRaw)) return NextResponse.json(EMPTY)

  // Debounced typeahead-style caller → IP throttle to bound DB amplification.
  const ip = clientIp(req)
  const rl = await rateLimit('price-guidance', ip, 60, '1 m')
  if (!rl.success) return NextResponse.json(EMPTY)

  const condition = (p.get('condition') || '').trim() || null
  const yearNum = Number.parseInt(p.get('year') || '', 10)
  const year = Number.isFinite(yearNum) ? yearNum : null

  try {
    if (!brandSlug) {
      const norm = normalizeBrand(brandRaw)
      if (norm.length < 2) return NextResponse.json(EMPTY)
      const hit = await db.brand.findUnique({ where: { normalized: norm }, select: { slug: true } })
      if (!hit) return NextResponse.json(EMPTY)
      brandSlug = hit.slug
    }
    // Free-typed model: resolve the canonical casing case-insensitively so
    // "wave alpha" still hits the "Wave Alpha" stat rows. The shared getPriceBand
    // stays exact-match — identical to the PDP path by project rule.
    const canonical = await db.$queryRaw<{ model: string }[]>`
      SELECT model FROM "PriceStat"
      WHERE "brandSlug" = ${brandSlug} AND lower(model) = lower(${model})
      LIMIT 1`
    const band = await getPriceBand({ brandSlug, model: canonical[0]?.model ?? model, condition, year })
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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { enrichBrandLogoIfMissing } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Backfill monotone brand logos from theSVG. By default only brands that would show a
// MONOGRAM (no simple-icons match + no curated logo). `?force=1` re-fetches ALL active
// brands (overrides simple-icons too — the wider/consistent source). Processes up to
// `limit` (default 40, max 100) per call so it can't time out; call again until
// `updated` is 0. Under force, pass `?before=<the response's cursor>` on every
// subsequent call — force skips enrichBrandLogoIfMissing's early return, so without
// the cursor each call would re-fetch the same top-`limit` brands (orderBy
// listingCount desc) and never advance past the first page. The cursor works because
// a successful force re-fetch stamps curatedAt (brand.ts). Admin-only.
//
// Trigger (logged in as admin), in the browser console:
//   fetch('/api/admin/backfill-brand-logos?limit=100',{method:'POST'}).then(r=>r.json()).then(console.log)
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const force = searchParams.get('force') === '1'
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 40, 1), 100)
  // Run-start cursor: first call mints it, later calls echo it back via ?before=.
  const beforeRaw = searchParams.get('before')
  const beforeDate = beforeRaw ? new Date(beforeRaw) : null
  const before = beforeDate && !isNaN(beforeDate.getTime()) ? beforeDate : null
  const cursor = before ?? new Date()

  const where = force
    ? {
        status: 'active',
        // Exclude brands already re-fetched this run (curatedAt stamped at/after the
        // run-start cursor). Fetch FAILURES don't stamp curatedAt and so repeat —
        // termination stays "run until updated=0".
        ...(before ? { OR: [{ curatedAt: null }, { curatedAt: { lt: before } }] } : {}),
      }
    : { status: 'active', iconSlug: null, OR: [{ logoPath: null }, { logoPath: '' }] }

  const matching = await db.brand.count({ where })
  const brands = await db.brand.findMany({ where, select: { slug: true }, orderBy: { listingCount: 'desc' }, take: limit })

  let updated = 0
  const found: string[] = []
  for (const b of brands) {
    try {
      if (await enrichBrandLogoIfMissing(b.slug, force)) { updated++; found.push(b.slug) }
    } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 150)) // be polite to theSVG
  }

  return NextResponse.json({
    processed: brands.length,
    updated,
    found,
    matchingTotal: matching,
    ...(force ? { before: cursor.toISOString() } : {}),
    note: force
      ? 'force=1: re-fetched from theSVG (overrides simple-icons). Pass ?before=<this before> on every next call and run until updated=0.'
      : 'Gap-fill only (kept simple-icons). Brands theSVG lacks stay as monograms — stop when updated=0.',
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'

export const runtime = 'nodejs'

// Brand catalogue read — powers the post-wizard datalist + the brand directory.
// `?q=` does an accent-insensitive prefix/contains match on the normalized key;
// otherwise returns the most-listed brands. Public, lightly cached.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = normalizeBrand(searchParams.get('q') || '')
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 60, 1), 200)

  const where = q
    ? { status: 'active', normalized: { contains: q } }
    : { status: 'active' }

  const brands = await db.brand.findMany({
    where,
    select: { slug: true, name: true, iconSlug: true, listingCount: true },
    orderBy: [{ listingCount: 'desc' }, { name: 'asc' }],
    take: limit,
  })

  return NextResponse.json(
    { brands },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}

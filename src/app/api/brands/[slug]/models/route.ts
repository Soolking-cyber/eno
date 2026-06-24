import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// Distinct MODELS of a brand that are present in the live catalogue — powers the
// brand rail's tap-to-expand (e.g. Kia → Carens, Cerato, Sorento…). Optionally
// scoped to a category (the rail's current context). Ranked by listing count.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const category = new URL(req.url).searchParams.get('category')?.trim()

  const grouped = await db.listing.groupBy({
    by: ['model'],
    where: {
      verified: true,
      status: 'active',
      brandSlug: slug,
      model: { not: null },
      ...(category && category !== 'all' ? { category: { slug: category } } : {}),
    },
    _count: { _all: true },
    orderBy: { _count: { model: 'desc' } },
    take: 60,
  })

  const models = grouped
    .filter((g) => g.model)
    .map((g) => ({ model: g.model as string, count: g._count._all }))

  return NextResponse.json(
    { models },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}

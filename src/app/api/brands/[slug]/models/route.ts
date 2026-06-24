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
    _sum: { views: true, contactCount: true },
    orderBy: { _count: { model: 'desc' } },
    take: 200,
  })

  // Rank models by live demand (views + weighted contacts), then count — so the
  // most-wanted models surface first; falls back to count before any traffic.
  const models = grouped
    .filter((g) => g.model)
    .map((g) => ({ model: g.model as string, count: g._count._all, demand: (g._sum.views ?? 0) + 5 * (g._sum.contactCount ?? 0) }))
    .sort((a, b) => b.demand - a.demand || b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 60)
    .map(({ demand: _d, ...m }) => m)

  return NextResponse.json(
    { models },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}

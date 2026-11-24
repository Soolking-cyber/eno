import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'

/**
 * The category a brand's live listings sit in most — what the explorer gives a bare `?brand=` link before it shows it
 * (listings-explorer.tsx, the brand-heal effect, through /api/search/resolve). Rentals count only when nothing else does.
 * Moved here from that route (Seobility, 2026-11-23) so a page can LINK the URL the explorer would end on —
 * `/?category=<this>&brand=<slug>` — instead of a bare `?brand=` that the explorer then rewrites, which a crawler that runs
 * JavaScript records as a link to a redirect.
 */
export async function dominantCategory(brandSlug: string): Promise<string | null> {
  const topCategoryId = async (excludeRent: boolean): Promise<string | null> => {
    const grouped = await db.listing.groupBy({
      by: ['categoryId'],
      where: await scopedListingWhere({ verified: true, status: 'active', brandSlug, ...(excludeRent ? { listingType: { not: 'rent' } } : {}) }),
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 1,
    })
    return grouped[0]?.categoryId ?? null
  }
  const categoryId = (await topCategoryId(true)) ?? (await topCategoryId(false))
  if (!categoryId) return null
  const cat = await db.category.findUnique({ where: { id: categoryId }, select: { slug: true } })
  return cat?.slug ?? null
}

/**
 * `dominantCategory` for many brands in three reads, whatever their number (/brands lists ~170): the same rule — the
 * category with the most live non-rental listings, else the most live listings — and the same tie order as one groupBy
 * per brand would give (count, then the row order the database returns). A brand with no live listing is left out.
 */
export async function dominantCategories(brandSlugs: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!brandSlugs.length) return out
  const counts = async (excludeRent: boolean) => db.listing.groupBy({
    by: ['brandSlug', 'categoryId'],
    where: await scopedListingWhere({ verified: true, status: 'active', brandSlug: { in: [...brandSlugs] }, ...(excludeRent ? { listingType: { not: 'rent' } } : {}) }),
    _count: { _all: true },
  })
  const top = (rows: Awaited<ReturnType<typeof counts>>) => {
    const best = new Map<string, { categoryId: string; n: number }>()
    for (const r of rows) {
      if (!r.brandSlug) continue
      const seen = best.get(r.brandSlug)
      if (!seen || r._count._all > seen.n) best.set(r.brandSlug, { categoryId: r.categoryId, n: r._count._all })
    }
    return best
  }
  const [withoutRent, all] = await Promise.all([counts(true), counts(false)])
  const a = top(withoutRent)
  const b = top(all)
  const ids = new Set([...a.values(), ...b.values()].map((v) => v.categoryId))
  const cats = await db.category.findMany({ where: { id: { in: [...ids] } }, select: { id: true, slug: true } })
  const slugOf = new Map(cats.map((c) => [c.id, c.slug]))
  for (const slug of brandSlugs) {
    const pick = a.get(slug) ?? b.get(slug)
    const cat = pick && slugOf.get(pick.categoryId)
    if (cat) out.set(slug, cat)
  }
  return out
}

/** The brand's link: with its category when it has one (the explorer's own end URL), else the bare brand. */
export function brandHref(brandSlug: string, category: string | null | undefined): string {
  const b = encodeURIComponent(brandSlug)
  return category ? `/?category=${encodeURIComponent(category)}&brand=${b}` : `/?brand=${b}`
}

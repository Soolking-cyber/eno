import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TAXONOMY, LISTING_TYPES, categoryHasBrand } from '@/lib/taxonomy'

// Lightweight taxonomy read for client surfaces that can't receive categories
// as server props (the account panel's bulk-upload section, the native iOS
// app's subcategory chips + post wizard). Slug + names, each category's
// subcategories, and — for the native wizard — the category's listing types,
// facet definitions (chips + ranges, incl. the condition toggle), and whether
// brand/model fields apply. All from the canonical code TAXONOMY (they aren't
// DB rows); changes only on taxonomy edits, so let the CDN hold it.
export async function GET() {
  const categories = await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, nameVi: true },
  })
  const typeLabel = new Map(LISTING_TYPES.map((t) => [t.value, t]))
  const metaBySlug = new Map(
    TAXONOMY.map((c) => [
      c.slug,
      {
        subcategories: c.subcategories.map((s) => ({ slug: s.slug, name: s.name, nameVi: s.nameVi, icon: s.icon })),
        types: c.types.map((v) => {
          const t = typeLabel.get(v)
          return { value: v, label: t?.label ?? v, labelVi: t?.labelVi ?? v }
        }),
        brandable: categoryHasBrand(c.slug),
        facets: c.facets.map((f) => ({
          key: f.key,
          label: f.label,
          labelVi: f.labelVi,
          kind: f.kind ?? 'select',
          subcats: f.subcats ?? null,
          options: f.options.map((o) => ({ value: o.value, label: o.label, labelVi: o.labelVi })),
          range: f.range
            ? { min: f.range.min, max: f.range.max, step: f.range.step, unit: f.range.unit ?? null, column: f.range.column }
            : null,
        })),
      },
    ]),
  )
  return NextResponse.json(
    {
      categories: categories.map((c) => ({
        ...c,
        subcategories: metaBySlug.get(c.slug)?.subcategories ?? [],
        types: metaBySlug.get(c.slug)?.types ?? [],
        brandable: metaBySlug.get(c.slug)?.brandable ?? false,
        facets: metaBySlug.get(c.slug)?.facets ?? [],
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
  )
}

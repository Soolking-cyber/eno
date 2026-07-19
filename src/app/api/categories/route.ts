import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TAXONOMY } from '@/lib/taxonomy'

// Lightweight taxonomy read for client surfaces that can't receive categories
// as server props (the account panel's bulk-upload section, the native iOS
// app's subcategory chips). Slug + names, plus each category's subcategories
// from the canonical code TAXONOMY (they aren't DB rows); changes only on
// taxonomy edits, so let the CDN hold it.
export async function GET() {
  const categories = await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, nameVi: true },
  })
  const subsBySlug = new Map(
    TAXONOMY.map((c) => [c.slug, c.subcategories.map((s) => ({ slug: s.slug, name: s.name, nameVi: s.nameVi }))]),
  )
  return NextResponse.json(
    { categories: categories.map((c) => ({ ...c, subcategories: subsBySlug.get(c.slug) ?? [] })) },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
  )
}

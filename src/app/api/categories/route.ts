import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Lightweight taxonomy read for client surfaces that can't receive categories
// as server props (the account panel's bulk-upload section). Slug + names only;
// changes only on taxonomy edits, so let the CDN hold it.
export async function GET() {
  const categories = await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, nameVi: true },
  })
  return NextResponse.json(
    { categories },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
  )
}

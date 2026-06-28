import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { vertexConfigured, importListingDocuments, listingToDoc } from '@/lib/vertex-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// One-off (re-runnable) backfill: push every public listing into the Vertex AI Search
// data store so the AI concierge has a catalog to search. Admin-gated. Run it once
// after standing up the data store (docs/vertex-search-setup.md), and again after a DB
// reset. Paginated by cursor; paces upserts so the Discovery Engine import isn't hammered.
//   curl -X POST https://eno.vn/api/admin/vertex-backfill   (with an admin session)
export async function POST(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!vertexConfigured()) return NextResponse.json({ error: 'vertex_not_configured' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const max = Math.min(Math.max(Number(searchParams.get('max')) || 5000, 1), 20000)

  let cursor: string | undefined
  let done = 0
  for (;;) {
    const batch = await db.listing.findMany({
      where: { verified: true, status: 'active' },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { category: true, seller: true },
    })
    if (!batch.length) break
    done += await importListingDocuments(batch.map(listingToDoc))
    cursor = batch[batch.length - 1].id
    if (done >= max || batch.length < 100) break
  }

  return NextResponse.json({ ok: true, indexed: done })
}

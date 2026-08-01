import { deskExcludedListingWhere } from '@/lib/edition-scope'
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
      /**
       * ⚠️ SCOPED, EVEN THOUGH THIS ROUTE IS ADMIN-ONLY — because the gate that matters here is not
       * who can CALL it, it is where its OUTPUT goes. This writes into the Vertex index, and that
       * index answers eno.vn's AI concierge. An admin re-running a backfill from eno.forum would
       * otherwise re-import the desk's 15 listings and silently undo the exclusion for the licensed
       * marketplace.
       *
       * ⚠️ AND `scopedListingWhere` DID NOT DO THAT, WHICH IS WHY THIS LINE CHANGED. It is
       * edition-CONDITIONAL — `marketplaceListingScope()` opens with `if (IS_SERVICES) return {}`
       * — so on the services build the exclusion this comment claimed was a literal no-op, and the
       * eno.forum admin it names as the threat was the one case it could not stop. Measured
       * 2026-08-01: 34 documents in the branch where 18 belonged, the extra 15 being the desk's.
       * `deskExcludedListingWhere` is the same AND-composed exclusion with the edition test
       * removed, because the DESTINATION is shared even when the writer's own surfaces are not.
       *
       * It THROWS when the desk cannot be resolved, and a 500 here is the outcome we want: the
       * import is INCREMENTAL (an upsert), so nothing downstream removes what a run wrote, and an
       * import that cannot prove which seller is the desk must not run at all.
       *
       * The sibling scripts/vertex-backfill.mjs was fixed first and this was nearly missed: they are
       * two independent implementations of the same import, and only the script is obvious. The
       * edition-lint allowlist covers src/app/api/admin/** on reachability grounds, which is correct
       * for reachability and wrong for data flow — noted there too.
       *
       * ListingDoc carries no sellerId, so no Vertex-side filter can express this after the fact.
       * Ingest is the only place it can be done.
       */
      where: await deskExcludedListingWhere({ verified: true, status: 'active' }),
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

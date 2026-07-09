import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { hashFromUrl, hexToBits } from '@/lib/image-hash'

// ── Cross-app image provenance (stolen-photo / duplicate-across-sellers detection) ────────
// Complements the seller-scoped duplicate guard: this looks across the WHOLE platform. A new
// listing whose photos match an OLDER listing from a DIFFERENT seller is very likely reusing
// (stealing) that seller's photos — the classic scam (copy a real post, relist as bait). We
// keep an HNSW Hamming index of every image's dHash (pgvector bit) and, post-publish, check a
// new listing against it. A MAJORITY-photo match to another seller ⇒ auto-hide THIS (the newer,
// copying) listing + file an admin "possible stolen photos" report + notify. The original is
// untouched (first poster presumed legit). Reversible (admin un-hides false positives — a
// legit reseller/stock photo); never auto-penalises trust. Cheap (indexed ANN, no AI). FAIL-OPEN.

// Stolen photos are re-encodes of the EXACT image → tiny Hamming distance. A tight threshold
// keeps genuinely-different stock photos of the same product apart.
const CROSS_THRESHOLD = 8

function parseImages(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Index a listing's image hashes and check whether it reuses another seller's photos. Runs
 *  via after() (off the response path) for EVERY new/edited listing — not trust-gated, since
 *  it's indexed DB work, not a paid AI call. */
export async function indexAndCheckProvenance(listingId: string): Promise<void> {
  try {
    const l = await db.listing.findUnique({
      where: { id: listingId },
      select: { id: true, images: true, status: true, sellerId: true, seller: { select: { ownerId: true } } },
    })
    if (!l || l.status !== 'active') return
    const hexes = Array.from(new Set(parseImages(l.images).map(hashFromUrl).filter((h): h is string => !!h)))
    if (hexes.length === 0) return

    // 1. CHECK — for each of my (distinct) images, find OTHER-seller ACTIVE listings whose image
    //    is within CROSS_THRESHOLD Hamming. Count, per other listing, how many of MY images it
    //    matched. (My own hashes aren't matched: they're inserted below, and the query excludes
    //    my sellerId anyway, which also covers the re-index-on-edit case.)
    const matchCount = new Map<string, number>()
    for (const hex of hexes) {
      const bits = hexToBits(hex)
      const rows = await db.$queryRaw<{ listingId: string }[]>(Prisma.sql`
        SELECT lih."listingId" AS "listingId"
        FROM "ListingImageHash" lih
        JOIN "Listing" li ON li.id = lih."listingId"
        WHERE lih."sellerId" <> ${l.sellerId}
          AND li.status = 'active' AND li.verified = true
          AND (lih.hash <~> ${bits}::bit(64)) <= ${CROSS_THRESHOLD}
        ORDER BY lih.hash <~> ${bits}::bit(64)
        LIMIT 3
      `)
      const seen = new Set<string>()
      for (const r of rows) {
        if (seen.has(r.listingId)) continue // count each other-listing once per my-image
        seen.add(r.listingId)
        matchCount.set(r.listingId, (matchCount.get(r.listingId) ?? 0) + 1)
      }
    }

    // 2. INDEX — replace this listing's rows (idempotent across re-index on edit) with fresh
    //    hashes so future listings can match against it.
    await db.$executeRaw(Prisma.sql`DELETE FROM "ListingImageHash" WHERE "listingId" = ${l.id}`)
    const values = hexes.map((hex) => Prisma.sql`(${l.id}, ${l.sellerId}, ${hexToBits(hex)}::bit(64))`)
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "ListingImageHash" ("listingId", "sellerId", hash) VALUES ${Prisma.join(values)}
    `)

    // 3. ENFORCE — a single other-seller listing matched a MAJORITY of my photos (≥2 and ≥50%)
    //    ⇒ this listing reuses that seller's photos. Auto-hide + admin report + notify.
    let best = 0
    let originalId = ''
    for (const [id, c] of matchCount) if (c > best) { best = c; originalId = id }
    if (best >= 2 && best >= Math.ceil(0.5 * hexes.length)) {
      await db.listing.update({ where: { id: l.id }, data: { status: 'hidden', verified: false } })
      await db.report.create({
        data: {
          listingId: l.id,
          reason: 'stolen_photos',
          detail: `Cross-app image match: reuses ${best}/${hexes.length} photos from another seller's listing ${originalId} (possible stolen listing).`,
          status: 'open',
          internalNote: `Auto-hidden by cross-app image provenance. Confirm if the photos were stolen, or dismiss + un-hide if this seller legitimately owns/reuses them (reseller/stock).`,
        },
      })
      if (l.seller?.ownerId) {
        await db.notification.create({
          data: {
            recipientId: l.seller.ownerId,
            type: 'system',
            title: 'Listing held for review',
            body: "Your listing was hidden pending review because its photos match another seller's listing. If these are your own photos, our team will restore it.",
            url: `/listings/${l.id}`,
          },
        })
      }
      console.warn(`[image-provenance] auto-held ${l.id} (reused ${best}/${hexes.length} from ${originalId})`)
    }
  } catch (e) {
    console.error('[image-provenance] failed (fail-open)', e)
  }
}

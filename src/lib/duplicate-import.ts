import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { MIN_IMPORT_DESCRIPTION_CHARS, isImport, isThinImport } from '@/lib/thin-import'

/**
 * ⛔ AN IMPORTED UNIT THAT REPEATS AN OLDER ONE OF THE SAME SELLER IS `noindex, follow`, AND LEFT OUT OF THE SITEMAP
 * (Seobility crawl 3, 2026-11-24: 88 duplicate titles and 246 duplicate descriptions, nearly all partner imports —
 * Victoria Village's seven identical 2-bedroom villas, Masteri Thảo Điền's identical apartments). Google had already said as
 * much ("Duplicate, Google chose different canonical", 432 GoPlus rooms, 2026-11-22 — thin-import.ts, the same "best proper
 * handling" the owner asked for there). A copy is: same seller, live, OLDER (created earlier; the id breaks a tie), and
 * either the same title at the same price — an identical <title> (titleWithPrice) — or the same description — an identical
 * meta description. The oldest copy stays indexable and listed; the others stay on the site, browsable and linked, and
 * pass their links (`follow`). A copy that outlives the original is indexable again from its next render.
 * ⛔ THE ORIGINAL MUST BE INDEXABLE ITSELF (gate review, 2026-11-24): an import, not a link-out (`affiliateUrl` null — the
 * vehicle-hire and linked-job references), and not thin (thin-import.ts). Otherwise an old thin copy would push a newer,
 * fuller one out of the index too, and the group would have no indexed page at all.
 * ⛔ IMPORTS ONLY (thin-import.ts isImport): a member's own post is a person's post, however alike two of them are.
 */
export type DuplicateImportRow = {
  id: string
  sellerId: string
  externalId: string | null
  title: string
  price: number
  description: string
  createdAt: Date
}

export async function isDuplicateImport(row: DuplicateImportRow): Promise<boolean> {
  if (!isImport(row.externalId)) return false
  // Within the edition's scope (edition-lint rule A), like every listing read: the copy that keeps the page indexed must be
  // one this edition shows.
  const older = await db.listing.findMany({
    where: await scopedListingWhere({
      sellerId: row.sellerId,
      id: { not: row.id },
      verified: true,
      status: 'active',
      affiliateUrl: null,
      externalId: { not: null },
      NOT: { externalId: { startsWith: 'fb:' } },
      AND: [
        { OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] },
        { OR: [{ title: row.title, price: row.price }, ...(row.description ? [{ description: row.description }] : [])] },
      ],
    }),
    select: { externalId: true, description: true },
    take: 25,
  })
  return older.some((o) => !isThinImport(o))
}

/**
 * The same rule in SQL for the sitemap's kept-imports read (src/lib/sitemap.ts), on the listing aliased `l`: true when an
 * older live, indexable import of the same seller repeats its title at its price, or its description.
 */
export const DUPLICATE_IMPORT_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM "Listing" o
  WHERE o."sellerId" = l."sellerId" AND o.id <> l.id AND o.verified AND o.status = 'active'
    AND o."affiliateUrl" IS NULL AND o."externalId" IS NOT NULL AND o."externalId" NOT LIKE 'fb:%'
    AND length(o.description) >= ${MIN_IMPORT_DESCRIPTION_CHARS}
    AND (o."createdAt" < l."createdAt" OR (o."createdAt" = l."createdAt" AND o.id < l.id))
    AND ((o.title = l.title AND o.price = l.price) OR (l.description <> '' AND o.description = l.description))
)`

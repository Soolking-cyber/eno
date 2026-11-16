import 'server-only'
import { db } from '@/lib/db'
import { HIDDEN_DESK_OWNER_EMAILS } from '@/lib/edition-scope'
import { VISA_SHOP_OWNER_EMAILS } from '@/lib/visa-shop'
import { TRIP_DESK_OWNER_EMAILS } from '@/lib/trips/dm-thread'

/**
 * ⛔ eno's OWN e-Visa / trip desk is EXEMPT from the listing photo check — pass, sweep, upload and save — like the
 * protected stores (listing-photo-check.ts PHOTO_CHECK_EXEMPT). The owner's call, 2026-11-16: "visa desk yes exempt" (the
 * desk's flyers are forum-only inventory in the shared database).
 * The desk = the storefronts owned by HIDDEN_DESK_OWNER_EMAILS, VISA_SHOP_OWNER_EMAIL(S) and TRIP_DESK_OWNER_EMAIL(S),
 * resolved read-only by owner email and cached for 10 minutes. A failed read throws (and is not cached): the pass then
 * writes nothing for that row.
 */
const TTL_MS = 10 * 60_000
let cached: { at: number; ids: Promise<ReadonlySet<string>> } | null = null

export function photoDeskSellerIds(): Promise<ReadonlySet<string>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ids
  const emails = [...new Set([...HIDDEN_DESK_OWNER_EMAILS, ...VISA_SHOP_OWNER_EMAILS, ...TRIP_DESK_OWNER_EMAILS])]
  const ids: Promise<ReadonlySet<string>> = emails.length
    // edition-lint-allow: the desk's storefront ids, to exempt them from the photo check; nothing is rendered.
    ? db.seller.findMany({ where: { owner: { email: { in: emails } } }, select: { id: true } }).then((rows) => new Set(rows.map((r) => r.id)))
    : Promise.resolve(new Set<string>())
  const entry = { at: Date.now(), ids }
  cached = entry
  ids.catch(() => { if (cached === entry) cached = null })
  return ids
}

export async function isPhotoDeskSeller(sellerId: string): Promise<boolean> {
  return !!sellerId && (await photoDeskSellerIds()).has(sellerId)
}

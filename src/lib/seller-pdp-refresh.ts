import 'server-only'
import { SELLER_INFO_NOTICE_SINCE } from '@/lib/seller-info'
import { db } from '@/lib/db'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { REVALIDATE_CAP } from '@/lib/listing-surfaces'
import { logError } from '@/lib/log'

/**
 * A SELLER'S IDENTITY OR ACCOUNT TYPE CHANGED → PURGE THEIR LISTING PAGES (review, 2026-10-01).
 *
 * The PDP is ISR with a 30-day window (listings/[id]/(pdp)/page.tsx `revalidate`), and it prints the
 * "Seller information" block (seller-info.tsx) off the seller row. Without this, a seller who deletes
 * their address, or switches back to an individual account, keeps their legal name and address on every
 * listing page for up to a month. Callers: updateSellerCore (an identity field was sent) and
 * /api/profile/account-type (the account type changed, or legal fields were written).
 *
 * Only ACTIVE listings: the sold page renders no seller identity, and anything else 404s. Past
 * REVALIDATE_CAP ids it purges the whole route once (the same rule as refreshListingSurfaces), never a
 * silent top-N. No reindex: AI search does not carry seller identity.
 *
 * ⚠️ NEVER THROWS. It runs after the write has landed; a failed purge is logged (once), not turned into
 * a 500 for a save that succeeded. Outside a request scope revalidatePath throws — logged the same way.
 */
export async function refreshSellerPdps(sellerId: string, op = 'sellerPdps'): Promise<void> {
  // ⛔ NOTHING TO REFRESH WHILE THE DISPLAY IS OFF: the Seller information block renders no legal detail
  // until SELLER_INFO_NOTICE_SINCE is set, so a save changes no page — and purging anyway let any business
  // seller with a big catalogue cold-start the WHOLE PDP cache on every save (opus, 2026-10-01). Same as
  // before this block existed.
  if (!SELLER_INFO_NOTICE_SINCE) return
  try {
    // edition-lint-allow: ONE seller's own ids, used only as cache keys to purge — nothing read here is
    // rendered, listed or fed anywhere, so no edition's surface can gain a row from it.
    const rows = await db.listing.findMany({ where: { sellerId, status: 'active' }, select: { id: true }, take: REVALIDATE_CAP + 1 })
    if (rows.length > REVALIDATE_CAP) {
      revalidatePublicPath('/listings/[id]', 'layout')
      return
    }
    let logged = false
    for (const r of rows) {
      try { revalidatePublicPath(`/listings/${r.id}`) } catch (e) {
        if (!logged) { logged = true; logError(e, { op: `${op}.purge`, sellerId }) }
      }
    }
  } catch (e) {
    logError(e, { op, sellerId })
  }
}

import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { SALE_CONFIRM_NOTIFICATION } from '@/lib/trade-loop'

/**
 * A listing back on sale asks nobody: withdraw EVERY "did you buy this?" bell row for it
 * (src/lib/core/sale-loop.ts writes them). Without it a buyer kept an unread question — counted in their
 * badge — that opened a thread with no question in it.
 *
 * Called by every path that puts a sold/hidden listing back on sale: setStatusCore's relist and
 * confirmCore's revive (src/lib/core/listings.ts) and the admin console's "Activate"
 * (src/app/api/admin/listings/route.ts). Its own module so that route need not import the listing cores.
 *
 * ⚠️ BY LISTING, NOT BY THE BUYER A READ SAW (commit gate, 2026-10-05). The buyer a reactivation READ is not
 * necessarily the buyer its write erased: a mark-sold re-attributing the sale to someone else between the
 * two left THAT buyer's row behind. Every row for the listing is withdrawn instead — and a row the mark-sold
 * writes only AFTER this ran is caught on its own side (notifySaleQuestion re-reads the listing once its
 * row exists, and removes it when the question is gone).
 * ⚠️ NOT INDEXED — Notification has no listingId index, and this change adds no migration — which is why the
 * cores run it only on a REAL reactivation, never on the partner sync's per-row re-send of 'active'.
 * Measured 2026-10-05 (read-only): ~125 rows / 112 kB in the table. Best-effort: a failure is logged and
 * never fails the reactivation.
 */
export async function withdrawSaleQuestions(listingIds: readonly string[]): Promise<void> {
  if (!listingIds.length) return
  try {
    await db.notification.deleteMany({
      where: { type: SALE_CONFIRM_NOTIFICATION, listingId: listingIds.length === 1 ? listingIds[0] : { in: [...listingIds] } },
    })
  } catch (e) {
    logError(e, { op: 'sale-withdraw.withdrawSaleQuestions' })
  }
}

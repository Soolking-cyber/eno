import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { adminCancelBankOrder, markBankOrderPaid } from '@/lib/ads/bank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin › Catalogue › Ads › Awaiting transfer (owner 2026-11-25: "ADMIN CONFIRMS"). One bank-transfer order:
 *   paid    the money is in eno's account — the ad starts (src/lib/ads/bank.ts markBankOrderPaid: book.ts's own activation,
 *           now or stacked after the target's running ads), who confirmed and when go into the row, and the advertiser
 *           gets the bilingual "Your ad is live" bell;
 *   cancel  eno closes the order.
 * Both idempotent: a second press changes nothing (`already: true`). getAdmin() is re-checked here (route auth 'admin').
 */
export const POST = route(
  { auth: 'admin', body: z.object({ adId: z.string().min(1).max(64), action: z.enum(['paid', 'cancel']) }) },
  async ({ admin, body }) => {
    const out = body.action === 'paid' ? await markBankOrderPaid(body.adId, admin) : await adminCancelBankOrder(body.adId, admin)
    if (!out.ok) {
      if (out.code === 'order_closed') throw new ApiError('order_closed', 409)
      throw new ApiError('not_found', 404)
    }
    return out
  },
)

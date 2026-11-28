import { completeCheckout } from '@/lib/ucp/checkout'
import { checkoutOptions, ucpCheckout } from '@/lib/ucp/checkout-http'

/** UCP checkout: POST …/complete — no payment instrument is taken here; it answers the session's state (requires_escalation
 *  with continue_url until the shop has paid on eno.vn, then completed). */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ucpCheckout(req, { mutates: true, replay: false, run: (_, profile) => completeCheckout(id, profile) })
}
export const OPTIONS = checkoutOptions

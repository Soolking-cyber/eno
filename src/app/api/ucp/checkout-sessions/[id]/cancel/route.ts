import { cancelCheckout } from '@/lib/ucp/checkout'
import { checkoutOptions, ucpCheckout } from '@/lib/ucp/checkout-http'

/** UCP checkout: POST …/cancel — only before an order exists (the order is then its shop's to cancel on eno.vn). */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ucpCheckout(req, { mutates: true, run: (_, profile) => cancelCheckout(id, profile) })
}
export const OPTIONS = checkoutOptions

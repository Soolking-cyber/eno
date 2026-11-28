import { createCheckout } from '@/lib/ucp/checkout'
import { checkoutOptions, ucpCheckout } from '@/lib/ucp/checkout-http'

/** UCP checkout: POST /api/ucp/checkout-sessions — a session for one eno.vn ad (src/lib/ucp/checkout.ts). */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return ucpCheckout(req, { mutates: true, creates: true, run: (body, profile) => createCheckout(body, profile) })
}
export const OPTIONS = checkoutOptions

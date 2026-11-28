import { getCheckout, updateCheckout } from '@/lib/ucp/checkout'
import { checkoutOptions, ucpCheckout } from '@/lib/ucp/checkout-http'

/** UCP checkout: GET (its state, read from the bank order each time) and PUT (the line, until an order exists). */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params
  return ucpCheckout(req, { mutates: false, run: (_, profile) => getCheckout(id, profile) })
}
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  return ucpCheckout(req, { mutates: true, run: (body, profile) => updateCheckout(id, body, profile) })
}
export const OPTIONS = checkoutOptions

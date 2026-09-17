import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { payoutTargetFor } from '@/lib/payments/orders'
import { buildVietQrPayload, vietqrTargetFrom } from '@/lib/payments/vietqr'
import { qrSvg } from '@/lib/qr-svg'
import { CheckoutView } from './checkout-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Payment | ${SITE_NAME}`,
  // ⛔ NEVER INDEXED. A checkout carries an order reference and an amount; a search engine holding
  // a copy of that page is a payment instruction cached in public.
  robots: { index: false, follow: false },
}

/**
 * THE PAGE A BUYER SCANS.
 *
 * ⛔ `.svc.` — this does not exist on eno.vn at all, excluded at BUILD time. eno.vn is deliberately
 * paymentless; a checkout is the single most obvious thing it must not have.
 *
 * ⛔ THE QR IS BUILT ON THE SERVER, FROM THE ORDER, ON EVERY REQUEST. Not stored, not cached, not
 * passed in by the client. A payload that arrived from the browser could name any account; one
 * built here can only name the account the seller saved and the amount the order records.
 *
 * ⚠️ AND THE SELLER'S BANK DETAILS NEVER REACH THE CLIENT AS DATA — only as the modules of a QR
 * image and a masked last-four. That is why the payload is built here and the view is given an SVG
 * string rather than an account number.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  /**
   * ⛔ A SIGNED-OUT BUYER IS SENT TO SIGN IN, NOT TO A 404. A reviewer walked it: a session that
   * expires while someone is deciding whether to pay would have dropped them on a dead page
   * mid-purchase, with no way back to the order they were looking at. The return path carries this
   * checkout so they land where they left off.
   * ⚠️ `/signin`, NOT `/sign-in` — verified against the route tree and the existing redirect in
   * listings/[id]/edit. Guessing the path would have produced the same dead end being fixed.
   * ⚠️ THE 404 BELOW IS A DIFFERENT CASE AND STAYS. Someone ELSE's order must be indistinguishable
   * from one that does not exist, or walking ids enumerates real orders and their references — and
   * a reference is the string a payment attaches to.
   */
  const profileId = await getCurrentProfileId()
  if (!profileId) redirect(`/signin?next=${encodeURIComponent(`/checkout/${id}`)}`)

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true, status: true, rail: true, amount: true, currency: true, reference: true,
      buyerId: true, sellerId: true,
      listing: { select: { title: true } },
      seller: { select: { name: true } },
    },
  })

  /**
   * ⛔ `notFound()` FOR SOMEONE ELSE'S ORDER, NOT A 403. A 403 confirms the order exists, so
   * walking ids would enumerate real orders and their references — and a reference is the string a
   * payment attaches to. Absent and forbidden must look identical from outside.
   */
  if (!order || order.buyerId !== profileId) notFound()

  const amount = Number(order.amount)

  /**
   * ⚠️ THE PAYLOAD IS ONLY BUILT FOR THE RAIL THE ORDER IS ACTUALLY ON. An order settled through the
   * wallet has no VietQR code, and drawing one from a seller's bank details for a USDC order would
   * invite a payment on a rail nothing is watching.
   */
  let qr: string | null = null
  let accountName: string | null = null
  let memo: string | null = null

  if (order.rail === 'vietqr' && order.status === 'awaiting_payment') {
    const payout = await payoutTargetFor(order.sellerId)
    const target = vietqrTargetFrom(payout)
    if (target && payout) {
      const built = buildVietQrPayload({ target, amountVnd: amount, memo: order.reference })
      if (built.ok) {
        qr = qrSvg(built.payload, { size: 240, title: 'VietQR payment code' })
        memo = built.memo
        accountName = payout.bankAccountName
      }
    }
  }

  return (
    <CheckoutView
      reference={order.reference}
      status={order.status}
      rail={order.rail}
      amount={amount}
      currency={order.currency}
      listingTitle={order.listing?.title ?? null}
      sellerName={order.seller?.name ?? null}
      qrSvg={qr}
      accountName={accountName}
      memo={memo}
    />
  )
}

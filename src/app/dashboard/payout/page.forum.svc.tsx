import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SITE_NAME } from '@/lib/edition'
import { PayoutClient } from './payout-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Payouts | ${SITE_NAME}`,
  // ⛔ NEVER INDEXED. The page discusses a bank account, even though it never renders the number.
  robots: { index: false, follow: false },
}

/**
 * WHERE A SELLER SAYS WHICH ACCOUNT TO BE PAID INTO.
 *
 * ⛔ `.svc.` — eno.vn is deliberately paymentless and this page does not exist there at all,
 * excluded at BUILD time rather than gated at runtime.
 *
 * ⚠️ A SHELL, BECAUSE THE FORM IS ENTIRELY INTERACTIVE. It reads the current state from the API on
 * mount rather than being server-rendered with it: the response is `cache-control: no-store` and
 * carries a masked account, and threading that through a server component would put it in the RSC
 * payload for no benefit.
 */
export default function PayoutPage() {
  return (
    <Suspense>
      <PayoutClient />
    </Suspense>
  )
}

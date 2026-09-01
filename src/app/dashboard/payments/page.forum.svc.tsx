import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SITE_NAME } from '@/lib/edition'
import { PaymentsClient } from './payments-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: `Payments | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * PAYMENTS — combines the former /dashboard/payout and /dashboard/wallet pages into one tabbed
 * screen (owner, 2026-09-01: reduce dashboard pages by intent). Both are "how a seller gets paid",
 * both are services-edition only, so `.forum.svc.` keeps the whole section off the licensed
 * marketplace exactly as the two pages were. The old URLs redirect here so bookmarks survive.
 */
export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsClient />
    </Suspense>
  )
}

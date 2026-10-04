import type { Metadata } from 'next'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { appReviewGate, isIosAppUserAgent } from '@/lib/app-review-gates'
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
export default async function PaymentsPage() {
  /**
   * ⚠️ APP STORE GATE `ios-hide-wallet` (plan R6; src/lib/app-review-gates.ts) — off by default. Under
   * Guideline 3.1.5 only an Organization may offer a wallet, and the wallet here is a live custody
   * adapter on this edition (Crossmint keys are set on the forum box, measured 2026-10-04). With the
   * gate on, the iOS app has no Payments row and a direct URL lands on the dashboard instead.
   * /dashboard/wallet and /dashboard/payout redirect HERE, so this one check covers all three.
   * The web and Android are untouched.
   */
  if (appReviewGate('ios-hide-wallet') && isIosAppUserAgent((await headers()).get('user-agent'))) redirect('/dashboard')
  return (
    <Suspense>
      <PaymentsClient />
    </Suspense>
  )
}

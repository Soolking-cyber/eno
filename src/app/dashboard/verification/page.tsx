import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SITE_NAME } from '@/lib/edition'
import { VerificationClient } from './verification-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Verification | ${SITE_NAME}`,
  // ⛔ NEVER INDEXED. The page discusses one person's identity and their company's registration.
  robots: { index: false, follow: false },
}

/**
 * THE TWO-STAGE VERIFICATION HUB — the dashboard section that finally makes the sequence visible.
 *
 * ⛔ NOT A `.svc.` PAGE. Identity verification is the LICENSED marketplace's obligation, not a
 * services-edition extra, so this exists on both editions. What differs is the sequencing gate
 * (`personBeforeBusinessEnforced()` is marketplace-only) — the page reflects that rather than
 * being absent.
 *
 * ⚠️ IT DOES NOT REPLACE `/dashboard/account/verify`. That route is the deep-link target
 * `publishBlockedBody()` sends every blocked seller to, and moving it would recreate the dead link
 * its own file header warns about. This page is the entry point a seller FINDS; that one is where
 * the capture happens.
 */
export default function VerificationPage() {
  return (
    <Suspense>
      <VerificationClient />
    </Suspense>
  )
}

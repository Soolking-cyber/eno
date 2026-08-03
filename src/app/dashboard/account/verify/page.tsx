import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { VerifyClient } from './verify-client'

// Identity verification (NĐ 248/2026). Reached from publishBlockedBody()'s verifyUrl — which
// pointed here before the page existed, so a blocked seller met a 404 on the one screen that is
// asking them for identity documents.
//
// ⚠️ No server auth gate, matching every sibling dashboard section: a server redirect races the
// client session restore and produces the signin↔dashboard bounce /dashboard/page.tsx warns about.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Verify your identity | ${SITE_NAME}`,
  // Signed-in, and it renders a legal declaration — never indexable, nothing follows out.
  robots: { index: false, follow: false },
}

export default function VerifyPage() {
  return <VerifyClient />
}

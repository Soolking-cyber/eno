import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { iosHideKycFor, iosHideKycOn } from '@/lib/ios-hide-kyc'
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

export default async function VerifyPage() {
  /**
   * ⚠️ APP STORE GATE `ios-hide-kyc` (D5 = b for eKYC; src/lib/ios-hide-kyc.ts) — off by default. This page photographs a
   * passport or CCCD and takes a live selfie; with the gate on, the iOS app is sent to the verification hub instead,
   * which shows the person's status and says the check is done in a web browser on this build's own site (eno.vn on
   * the marketplace build — the one the iOS app loads since 2026-10-06). Every way in —
   * the hub's button, a publish refusal's verifyUrl, the business panel, a bookmark — lands on this one check.
   * Not an auth redirect (see the note above): it keys on the user agent alone, so it cannot race the session.
   */
  // The flag first, as the payments page does: off ⇒ the request headers are never read.
  if (iosHideKycOn() && iosHideKycFor((await headers()).get('user-agent'))) redirect('/dashboard/verification')
  return <VerifyClient />
}

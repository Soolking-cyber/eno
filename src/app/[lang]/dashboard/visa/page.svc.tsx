import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'
import { appReviewGate } from '@/lib/app-review-gates'
import { iosHideVisaFor } from '@/lib/ios-hide-visa'

// MOVED into the Services section as a tab (2026-09-01). /visa/apply is untouched; only this index
// redirects so old links land on the e-Visa tab. The threads fetch now lives in lib/visa/viewer-threads.
//
// ⚠️ THE QUERY STRING MUST SURVIVE. The e-Visa providers return the applicant to
// /dashboard/visa?paid=stripe&aid=…&sid=… (or ?paid=paypal&aid=… / ?pay=cancelled) and cases-client
// reads those off the URL to confirm the charge (src/lib/visa/payments.ts). Dropping them here would
// silently break payment confirmation — dashboardTabTarget carries them onto the e-Visa tab.
export default async function VisaRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // ⚠️ App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — off by default. With it on, the iOS app has
  // no e-Visa tab, so its cases list and every "continue / start / pay" on it are not reachable there: Services opens
  // on Trips. A payment-return query cannot arrive in the app (nothing there starts a payment). /visa/apply lands here.
  // The flag first, as the payments page does: off ⇒ the request headers are never read.
  if (appReviewGate('ios-hide-visa') && iosHideVisaFor((await headers()).get('user-agent'))) redirect('/dashboard/services')
  redirect(dashboardTabTarget('/dashboard/services', 'evisa', await searchParams))
}

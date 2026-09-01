import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'

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
  redirect(dashboardTabTarget('/dashboard/services', 'evisa', await searchParams))
}

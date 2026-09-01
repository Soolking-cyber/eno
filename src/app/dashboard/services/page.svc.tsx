import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SITE_NAME } from '@/lib/edition'
import { getTripAssistanceListingId } from '@/lib/trips/dm-thread'
import { visaThreadsForViewer } from '@/lib/visa/viewer-threads'
import { ServicesClient, ServicesFallback } from './services-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: `Services | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * SERVICES — combines the former /dashboard/trips and /dashboard/visa into one tabbed section
 * (owner, 2026-09-01). Both clients need server-fetched data, resolved here and threaded through
 * the shell; the detail sub-routes (/trips/[id], /trips/plan, /visa/apply) are untouched and only
 * the two index pages redirect in. `.svc.` matches the tier the trips/visa pages used.
 */
async function ServicesBody() {
  // ⚠️ BOTH tabs' server data is resolved here in parallel, every render. Two things follow, and the
  // second corrects an easy misconception: (1) each tab's client takes its data as a prop, so
  // fetching only one tab's data would leave the other with missing props. (2) This route is
  // `force-dynamic`, so a client-side tab switch (DashboardTabs does `router.replace` with a new
  // `?tab=`) DOES refetch the RSC and re-run both reads — there is no free client-only switch. That
  // is accepted: both are cheap viewer-scoped reads (a single trip listing id + an ids-only visa
  // thread map that decrypts nothing). What mount-on-demand still buys is the EXPENSIVE part — only
  // the active tab's client mounts, so the inactive tab's own /api effects never fire.
  // ⚠️ ISOLATED, NOT a bare Promise.all. The e-Visa tab is where a payment provider returns the
  // applicant (?paid=…) and VisaCasesClient posts the confirmation, so a FAILURE IN THE UNRELATED
  // TRIP LOOKUP must not reject the whole render and take the visa side down with it. Each read fails
  // soft to its own empty value (visaThreadsForViewer already swallows internally; this catch guards
  // the trip read symmetrically), so one service degrading never blocks the other — least of all the
  // money path.
  const [planListingId, threads] = await Promise.all([
    getTripAssistanceListingId().catch(() => null),
    visaThreadsForViewer().catch(() => ({})),
  ])
  return <ServicesClient planListingId={planListingId} threads={threads} />
}

export default function ServicesPage() {
  return (
    <Suspense fallback={<ServicesFallback />}>
      <ServicesBody />
    </Suspense>
  )
}

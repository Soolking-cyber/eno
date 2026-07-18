import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PlanClient } from './plan-client'

// Per-user planner behind a cookie session — never statically cached (the same
// posture as the parent /dashboard/trips section).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Itinerary planner | eno.vn',
  robots: { index: false, follow: false },
}

export default function TripPlanPage() {
  return (
    <Suspense>
      <PlanClient />
    </Suspense>
  )
}

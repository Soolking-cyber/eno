import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TripDetailClient } from './trip-detail-client'
import { openCaseForItinerary } from '@/lib/trips/assistance'

// Per-user data behind a cookie session — must never be statically cached. Same reason
// dashboard/trips/page.tsx carries this: the loaders catch broadly, which would otherwise
// swallow Next's dynamic bailout during the build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Itinerary | ${SITE_NAME}`,
  // noindex, like every other /dashboard page: this is one traveller's private trip.
  robots: { index: false, follow: false },
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // ⚠️ READ ON THE SERVER, HANDED DOWN. The panel needs to know whether the caller already has an
  // open case before it can offer to withdraw it, and there is no GET endpoint that answers
  // "my open case for this itinerary" — adding one is a route this task does not own. This page is
  // already a server component, so it can just ask. The read is session-scoped inside the lib
  // function, so nothing here can request somebody else's case.
  const openCase = await openCaseForItinerary({ itineraryId: id })
  return (
    <Suspense>
      <TripDetailClient id={id} openCase={openCase} />
    </Suspense>
  )
}

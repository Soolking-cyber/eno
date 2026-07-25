import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TripDetailClient } from './trip-detail-client'

// Per-user data behind a cookie session — must never be statically cached. Same reason
// dashboard/trips/page.tsx carries this: the loaders catch broadly, which would otherwise
// swallow Next's dynamic bailout during the build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Itinerary | eno.vn',
  // noindex, like every other /dashboard page: this is one traveller's private trip.
  robots: { index: false, follow: false },
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <TripDetailClient id={id} />
    </Suspense>
  )
}

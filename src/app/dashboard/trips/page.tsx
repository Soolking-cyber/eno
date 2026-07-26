import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTripAssistanceListingId } from '@/lib/trips/dm-thread'
import { TripsClient } from './trips-client'

// Per-user data behind a cookie session — must never be statically cached; the
// loaders catch broadly, which would swallow Next's dynamic bailout during build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Itineraries | eno.vn',
  robots: { index: false, follow: false },
}

export default async function TripsPage() {
  // Planning moved into chat (owner, 2026-07-26), so this page needs a way to SEND somebody there.
  // The thread hangs off the trip desk's listing, and only the server can resolve which listing
  // that is — so it is resolved here and passed down rather than guessed at in the client.
  //
  // null is a real state, not an error: before the desk listing is seeded there is nowhere to send
  // anyone, and the empty state says so instead of offering a link to nothing.
  const planListingId = await getTripAssistanceListingId()
  return (
    <Suspense>
      <TripsClient planListingId={planListingId} />
    </Suspense>
  )
}

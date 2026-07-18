import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TripsClient } from './trips-client'

// Per-user data behind a cookie session — must never be statically cached; the
// loaders catch broadly, which would swallow Next's dynamic bailout during build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Itineraries | eno.vn',
  robots: { index: false, follow: false },
}

export default function TripsPage() {
  return (
    <Suspense>
      <TripsClient />
    </Suspense>
  )
}

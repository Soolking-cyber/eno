import type { Metadata } from 'next'
import { AvailabilityClient } from './availability-client'

export const metadata: Metadata = {
  title: 'Availability review | eno.vn',
  robots: { index: false, follow: false },
}

export default function AvailabilityPage() {
  return <AvailabilityClient />
}

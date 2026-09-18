import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { AvailabilityClient } from './availability-client'

export const metadata: Metadata = {
  title: `Availability review | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default function AvailabilityPage() {
  return <AvailabilityClient />
}

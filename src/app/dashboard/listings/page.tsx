import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ListingsTabs } from './listings-tabs'

export const metadata: Metadata = {
  title: `Listings | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default function ListingsPage() {
  return (
    <Suspense>
      <ListingsTabs />
    </Suspense>
  )
}

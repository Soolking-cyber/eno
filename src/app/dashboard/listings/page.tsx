import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ListingsClient } from './listings-client'

export const metadata: Metadata = {
  title: 'Listings | eno.vn',
  robots: { index: false, follow: false },
}

export default function ListingsPage() {
  return (
    <Suspense>
      <ListingsClient />
    </Suspense>
  )
}

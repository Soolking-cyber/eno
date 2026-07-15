import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DisputesClient } from './disputes-client'

export const metadata: Metadata = {
  title: 'Disputes | eno.vn',
  robots: { index: false, follow: false },
}

export default function DisputesPage() {
  return (
    <Suspense>
      <DisputesClient />
    </Suspense>
  )
}

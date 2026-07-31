import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DisputesClient } from './disputes-client'

export const metadata: Metadata = {
  title: `Disputes | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default function DisputesPage() {
  return (
    <Suspense>
      <DisputesClient />
    </Suspense>
  )
}

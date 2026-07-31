import { SITE_NAME } from '@/lib/edition'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { BulkClient } from './bulk-client'

export const metadata: Metadata = {
  title: `Bulk upload | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/** Bulk upload now renders in <main> as a dashboard section page (owner decision
 *  2026-07-15) — it no longer redirects into the account panel. */
export default function BulkPage() {
  return (
    <Suspense>
      <BulkClient />
    </Suspense>
  )
}

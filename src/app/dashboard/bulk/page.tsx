import { Suspense } from 'react'
import type { Metadata } from 'next'
import { BulkRedirect } from './redirect-client'

export const metadata: Metadata = { title: 'Bulk upload — eno.vn', robots: { index: false } }

/** Bulk upload lives INSIDE the account panel now (the panel is the dashboard,
 *  user decision 2026-07-14) — this route only lands existing links there. */
export default function BulkPage() {
  return (
    <Suspense>
      <BulkRedirect />
    </Suspense>
  )
}

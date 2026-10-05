import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BreakUiClient } from './break-ui-client'

export const metadata: Metadata = { title: 'Break UI (dev)', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/**
 * ⛔ DEV-ONLY. Served by `next dev` and by a LOCAL preview build (NEXT_PUBLIC_LOCAL_AUTH=1, which only
 * scripts/preview.mjs and the scratch-DB recipe set — the deploy env never does, src/lib/auth-origin.ts).
 * Everywhere else it is a 404: the page never RENDERS for a visitor. Its client chunk (fake fixture data only,
 * linked from nowhere) is still compiled into every build — `next build` emits it whatever `notFound()` decides
 * at request time. Its buttons are the real ones — the contract that bounds them is in break-ui-client.tsx.
 */
export default function BreakUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_LOCAL_AUTH !== '1') notFound()
  return (
    <Suspense>
      <BreakUiClient />
    </Suspense>
  )
}

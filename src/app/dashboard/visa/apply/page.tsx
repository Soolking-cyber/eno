import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { VisaApplyClient } from './apply-client'

// Per-user encrypted case data behind a cookie session — never statically cached.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vietnam e-Visa assistant | eno.vn',
  robots: { index: false, follow: false },
}

/** /dashboard/visa/apply — the in-hub Vietnam e-Visa ASSISTANT (the forum's /visa wizard
 *  ported into the dashboard; see apply-client.tsx). Renders inside the dashboard
 *  layout's main like every sibling section; the client gates auth and fetches. */
export default function VisaApplyPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <VisaApplyClient />
    </Suspense>
  )
}

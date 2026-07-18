import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { VisaApplyClient } from './apply-client'

// /dashboard/visa — the e-Visa ASSISTANT opens directly (owner 2026-07-18: no
// list-first hop; the retired list page proxied eno.forum for data the local
// /api/visa/applications now serves). The assistant self-manages every state —
// landing hero, wizard, read-only status, payment return — and renders the
// account's previous applications as a history feed beneath itself.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vietnam e-Visa | eno.vn',
  robots: { index: false, follow: false },
}

export default function VisaPage() {
  return (
    // Suspense: the client reads useSearchParams for the payment-return params.
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

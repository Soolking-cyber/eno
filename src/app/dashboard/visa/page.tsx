import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { fetchForumVisaApplications } from '@/lib/forum-visa'
import { VisaClient } from './visa-client'

// Per-user data behind a cookie session — must never be statically cached; the
// loaders catch broadly, which would swallow Next's dynamic bailout during build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vietnam e-Visa | eno.vn',
  robots: { index: false, follow: false },
}

// SERVER fetch (unlike the other client-fetching dashboard sections): the Bearer token
// comes from the httpOnly session cookie, so the proxy call must happen here — the
// browser never sees the token in markup and no client visa endpoint exists on eno.vn.
async function VisaSection() {
  const initial = await fetchForumVisaApplications()
  return <VisaClient initial={initial} />
}

export default function VisaPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <VisaSection />
    </Suspense>
  )
}

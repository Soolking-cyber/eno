'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { BulkUploadPanel } from '@/components/marketplace/bulk-upload-panel'
import { Spinner } from '@/components/ui/spinner'

/** Bulk CSV upload — a business-tier dashboard section that renders in <main>.
 *  Auth-gated (→ /signin) and tier-gated: bulk import is business-only, so an
 *  individual seller is sent to their listings instead. */
export function BulkClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { dash } = useDashboard()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/bulk')
  }, [loading, user, router])

  // Business-only: once the dashboard payload lands, bounce individuals to their listings.
  useEffect(() => {
    if (dash && dash.tier !== 'business') router.replace('/dashboard/listings')
  }, [dash, router])

  const gating = loading || !user || !dash || dash.tier !== 'business'
  if (gating) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <>
      <h1 className="text-xl font-bold text-foreground">{tr('Bulk upload', 'Tải hàng loạt')}</h1>
      <div className="mt-4">
        <BulkUploadPanel onDone={() => router.push('/dashboard/listings')} />
      </div>
    </>
  )
}

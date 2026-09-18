'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { BulkUploadPanel } from '@/components/marketplace/bulk-upload-panel'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionHeader } from '@/components/marketplace/section-header'

/** Bulk CSV upload — a business-tier dashboard section that renders in <main>.
 *  Auth-gated (→ /signin) and tier-gated: bulk import is business-only, so an
 *  individual seller is sent to their listings instead. */
export function BulkClient({ embedded = false }: { embedded?: boolean } = {}) {
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
    // Content-shaped first paint + the native stack title bar (this section was the one missing it).
    //
    // ⚠️ THE h1 AND ITS `mt-4` WRAPPER BELONG TO THE SHAPE. The loaded state renders a
    // `text-xl font-bold max-lg:sr-only` heading and then drops the panel 16px lower, so a
    // bare 256px block landed the panel 44px above where it actually appears on desktop.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        {!embedded && <SectionHeader title={tr('Bulk upload', 'Tải hàng loạt')} />}
        {!embedded && <Skeleton className="h-7 w-40 rounded-lg max-lg:hidden" />}
        <div className="mt-4 space-y-3">
          {/* The panel: a drop zone over its instructions + the template/upload actions. */}
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-40 rounded-xl" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — the one section that was missing its back bar. */}
      {!embedded && <SectionHeader title={tr('Bulk upload', 'Tải hàng loạt')} />}
      {!embedded && <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Bulk upload', 'Tải hàng loạt')}</h1>}
      <div className="mt-4">
        <BulkUploadPanel onDone={() => router.push('/dashboard/listings')} />
      </div>
    </>
  )
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Skeleton } from '@/components/ui/skeleton'
import { Rows, Row } from '@/components/ui/rows'
import { DisputesPanel } from '@/components/marketplace/disputes-panel'
import { SectionHeader } from '@/components/marketplace/section-header'

/** /dashboard/disputes — my dispute cases as a full in-<main> section page.
 *  Self-contained: <DisputesPanel> fetches its own data. Renders the roomy
 *  default variant (compact was the cramped in-panel tab). */
export function DisputesClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/disputes')
  }, [loading, user, router])

  if (loading || !user) {
    // Content-shaped first paint: the stack title bar + row skeletons, not a centered spinner.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <SectionHeader title={tr('Disputes', 'Khiếu nại')} />
        <Rows className="mt-2">
          {Array.from({ length: 3 }).map((_, i) => <Row key={i}><Skeleton className="h-12 rounded-lg" /></Row>)}
        </Rows>
      </div>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Disputes', 'Khiếu nại')} />
      {/* No wrapper <h1> — DisputesPanel renders its own (icon + title), so the wrapper
          copy made TWO h1s on one page (strict-mode e2e catch, 2026-07-23) and a doubled
          visible title on desktop. Same fix help-client.tsx already carries. */}
      <DisputesPanel />
    </>
  )
}

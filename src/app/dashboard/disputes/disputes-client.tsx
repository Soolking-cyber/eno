'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'
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
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
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

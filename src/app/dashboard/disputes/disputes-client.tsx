'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'
import { DisputesPanel } from '@/components/marketplace/disputes-panel'

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
      <h1 className="text-xl font-bold text-foreground">{tr('Disputes', 'Khiếu nại')}</h1>
      <div className="mt-4">
        <DisputesPanel />
      </div>
    </>
  )
}

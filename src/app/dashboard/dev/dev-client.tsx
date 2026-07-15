'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Spinner } from '@/components/ui/spinner'
import { DevelopersPanel } from '@/components/marketplace/developers-panel'

/** /dashboard/dev — the partner API / developers section. Business-tier only:
 *  individuals have no dev surface, so once the dashboard payload confirms a
 *  non-business tier we bounce to /dashboard/listings. */
export function DevClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { dash } = useDashboard()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/dev')
  }, [loading, user, router])

  useEffect(() => {
    if (dash && dash.tier !== 'business') router.replace('/dashboard/listings')
  }, [dash, router])

  // Auth gate, plus wait for the dashboard payload to confirm the business tier.
  if (loading || !user || !dash || dash.tier !== 'business') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <>
      <h1 className="text-xl font-bold text-foreground">{tr('Developers', 'Lập trình')}</h1>
      <div className="mt-4">
        <DevelopersPanel />
      </div>
    </>
  )
}

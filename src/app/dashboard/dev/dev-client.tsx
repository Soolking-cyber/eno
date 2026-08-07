'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Skeleton } from '@/components/ui/skeleton'
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
    // ⚠️ CONTENT-SHAPED, NOT A CENTRED SPINNER — the third and last copy of the
    // `min-h-[50vh]` Spinner gate that every other dashboard section left behind in f359299b.
    // Mirrors the loaded state: the text-xl h1, then <DevelopersPanel>'s two space-y-6
    // blocks (API keys, Webhooks), each an h-section heading over a lede and a list.
    return (
      <div className="w-full" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <Skeleton className="h-7 w-40 rounded-lg" />
        <div className="mt-4 w-full space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-[calc(var(--text-section)*1.3)] w-32" />
              <div className="mt-1 space-y-1">
                <Skeleton className="h-5 w-full max-w-lg" />
                <Skeleton className="h-5 w-2/3 max-w-md" />
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-16 w-full rounded-2xl" />
                <Skeleton className="h-16 w-full rounded-2xl" />
              </div>
            </div>
          ))}
        </div>
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

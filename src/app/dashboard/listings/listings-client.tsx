'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/** /dashboard/listings — the seller's listings management, rendered in <main>.
 *  Reads the shared dashboard cache so an edit/delete here re-pulls the one source. */
export function ListingsClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const { dash, refresh } = useDashboard()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/listings')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div role="status" className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // First name for the greeting (business name → display name → nothing).
  const name = (dash?.profile.businessName || dash?.profile.displayName || '').trim().split(/\s+/)[0]

  return (
    <>
      {/* Native stack-nav title bar (mobile only). Title = this section's established nav
          name (dashboard-nav's tr('My listings','Tin của tôi')); the greeting h1 below is a
          hero, not a duplicate of it, so it stays visible on every size. */}
      <SectionHeader title={tr('My listings', 'Tin của tôi')} />
      {/* Gemini-style greeting hero — a light, crisp welcome that floats on the flat dashboard
          canvas (globals .dashboard-canvas) instead of a bold boxed title. */}
      <div className="space-y-1">
        <h1 className="h-greeting text-ink-2">
          {tr('Hi', 'Chào')}{name ? ` ${name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{tr('Manage your listings', 'Quản lý tin đăng của bạn')}</p>
      </div>
      <div className="mt-6">
        {!dash ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        ) : dash.listings.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}
            </p>
            <Button variant="cta" asChild>
              <Link href="/post">{tr('Post a listing', 'Đăng tin')}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {dash.listings.map((l) => (
              <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

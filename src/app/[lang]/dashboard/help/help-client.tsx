'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { HelpCenter } from '@/components/marketplace/help-center'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Skeleton } from '@/components/ui/skeleton'
import type { HelpCenterData } from '@/lib/help-center-data'

export function HelpClient({ data }: { data: HelpCenterData }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/help')
  }, [loading, user, router])

  if (loading || !user) {
    // ⚠️ CONTENT-SHAPED, NOT A CENTRED SPINNER. Every other dashboard section moved off the
    // `min-h-[50vh]` Spinner in f359299b precisely because it flashes and then pops to a full
    // layout; Help, visa and dev were simply never converted. This mirrors <HelpCenter>'s own
    // opening: the h-display h1, the max-w-[70ch] lede, the rounded-xl search box, the topic
    // chip row and the two-column answer groups — with the stack title bar the loaded state
    // also renders, so the bar does not appear out of nowhere.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <SectionHeader title={tr('Help', 'Trợ giúp')} />
        <div className="w-full">
          <Skeleton className="h-[calc(var(--text-display)*1.12)] w-80 max-w-full" />
          <div className="mt-4 max-w-[70ch] space-y-1">
            <Skeleton className="h-[22px] w-full" />
            <Skeleton className="h-[22px] w-full" />
            <Skeleton className="h-[22px] w-2/3" />
          </div>
          {/* Search box (px-3 + py-3 on a text-base input → 48px) */}
          <Skeleton className="mt-6 h-12 w-full rounded-xl" />
          {/* Topic chips (h-10 rounded-full) */}
          <div className="-mx-3 mt-4 flex gap-2 px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {['w-24', 'w-28', 'w-20', 'w-32', 'w-24'].map((w, i) => (
              <Skeleton key={i} className={`h-10 shrink-0 rounded-full ${w}`} />
            ))}
          </div>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-[calc(var(--text-section)*1.3)] w-40" />
                {Array.from({ length: 3 }).map((__, j) => (
                  <Skeleton key={j} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // The old wrapper printed its own "Help" <h1> above HelpCenter, which now renders
  // an <h1> of its own — two h1s on one page. SectionHeader is the mobile stack-nav
  // title every other dashboard section uses and adds no heading to the outline.
  return (
    <>
      <SectionHeader title={tr('Help', 'Trợ giúp')} />
      <HelpCenter data={data} />
    </>
  )
}

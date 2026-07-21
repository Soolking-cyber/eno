'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { HelpCenter } from '@/components/marketplace/help-center'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Spinner } from '@/components/ui/spinner'
import type { HelpCenterData } from '@/lib/help-center-data'

export function HelpClient({ data }: { data: HelpCenterData }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/help')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
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

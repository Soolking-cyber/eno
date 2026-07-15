'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { HelpCenter } from '@/components/marketplace/help-center'
import { Spinner } from '@/components/ui/spinner'

export function HelpClient() {
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

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground">{tr('Help', 'Trợ giúp')}</h1>
      <div className="mt-4">
        <HelpCenter />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccountPanel } from '@/components/marketplace/account-panel'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'

export function BulkRedirect() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { openAfterNav } = useAccountPanel()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true
    if (!user) { router.replace('/signin?next=%2Fdashboard%2Fbulk'); return }
    openAfterNav('bulk')
    router.replace('/')
  }, [loading, user, openAfterNav, router])

  // ui/spinner is aria-hidden, so the accessible name lives on the wrapper — this screen
  // is otherwise empty, and it's the twin of dashboard/redirect-client.
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
      <Spinner size="lg" />
    </div>
  )
}

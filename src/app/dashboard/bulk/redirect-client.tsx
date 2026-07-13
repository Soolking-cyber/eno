'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccountPanel } from '@/components/marketplace/account-panel'
import { useAuth } from '@/context/auth-context'

export function BulkRedirect() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { openAfterNav } = useAccountPanel()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true
    if (!user) { router.replace('/signin?next=%2Fdashboard%2Fbulk'); return }
    openAfterNav('bulk')
    router.replace('/')
  }, [loading, user, openAfterNav, router])

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Loading" />
    </div>
  )
}

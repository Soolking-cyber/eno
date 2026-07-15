'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'

/** Each dashboard section is now its own page in <main> (owner decision
 *  2026-07-15); the account panel no longer IS the dashboard. /dashboard is the
 *  dashboard HOME: it maps the legacy `?tab=` deep link (notifications, mobile
 *  nav) to the matching section route and lands the visitor there. No tab →
 *  the listings section. `tab=post` still deep-links to the post wizard. */
const TAB_TO_ROUTE: Record<string, string> = {
  listings: '/dashboard/listings',
  account: '/dashboard/settings',
  disputes: '/dashboard/disputes',
  dev: '/dashboard/dev',
  help: '/dashboard/help',
  post: '/post',
}

export function DashboardRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true
    const tab = searchParams.get('tab')
    if (!user) { router.replace('/signin?next=' + encodeURIComponent(`/dashboard${tab ? `?tab=${tab}` : ''}`)); return }
    router.replace(TAB_TO_ROUTE[tab ?? ''] ?? '/dashboard/listings')
  }, [loading, user, searchParams, router])

  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
      <Spinner size="lg" />
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccountPanel, type PanelView } from '@/components/marketplace/account-panel'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'

const TAB_TO_VIEW: Record<string, PanelView> = {
  listings: 'listings',
  account: 'settings',
  disputes: 'disputes',
  dev: 'dev',
  help: 'help',
}

/** /dashboard is a redirect into the account panel (the panel IS the dashboard,
 *  user decision 2026-07-14). openAfterNav arms the SHELL (which survives this
 *  page unmounting) to open the mapped section once the replace() lands. */
export function DashboardRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()
  const { openAfterNav } = useAccountPanel()
  const { tr } = useLanguage()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true
    const tab = searchParams.get('tab')
    if (!user) { router.replace('/signin?next=' + encodeURIComponent(`/dashboard${tab ? `?tab=${tab}` : ''}`)); return }
    if (tab === 'post') { router.replace('/post'); return }
    openAfterNav(TAB_TO_VIEW[tab ?? ''] ?? 'root')
    router.replace('/')
  }, [loading, user, searchParams, openAfterNav, router])

  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
      <Spinner size="lg" />
    </div>
  )
}

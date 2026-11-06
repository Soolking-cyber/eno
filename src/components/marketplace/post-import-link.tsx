'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { facebookAvailableHere, facebookIosApp } from '@/lib/facebook-signin'

/** The post page's way to Import from Facebook (owner, 2026-11-04: "add it to my listings posting page etc"). Signed-in, where it can run: a browser or the iOS app. Beside the wizard, never in it. */
export function PostImportLink() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!user || !(facebookAvailableHere() || facebookIosApp())) return
    // Only where import is switched on: a link to "isn't available" is a dead end on the post page.
    let live = true
    void fetch('/api/fb-import', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d: { on?: boolean } | null) => { if (live) setShow(!!d?.on) }).catch(() => {})
    return () => { live = false }
  }, [user])
  if (!user || !show) return null
  return (
    <p className="mx-auto mb-4 max-w-2xl text-sm text-body">
      {tr('Already selling on Facebook Marketplace?', 'Đã bán trên Facebook Marketplace?')}{' '}
      <Link href="/dashboard/listings?tab=facebook" className="font-semibold text-primary underline-offset-2 hover:underline">{tr('Import your listings', 'Nhập các tin của bạn')}</Link>
    </p>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useAccountPanel } from './account-panel'

type Me = { avatarUrl: string | null }

/** Header avatar — ICON-ONLY (user decision 2026-07-13, matching the bell to
 *  its left). Toggles the right-side account/dashboard panel instead of a
 *  dropdown; the panel itself lives in account-panel.tsx via layout. */
export function AccountMenu() {
  const { user } = useAuth()
  const { tr } = useLanguage()
  const { open, setOpen } = useAccountPanel()
  const [me, setMe] = useState<Me | null>(null)

  // Instant paint from the cached dashboard profile so the avatar isn't blank.
  useEffect(() => {
    if (!user) { setMe(null); return }
    try {
      const c = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
      if (c?.userId === user.id && c.dashboard?.profile) setMe({ avatarUrl: c.dashboard.profile.avatarUrl })
    } catch {}
    fetch('/api/me').then((r) => r.json()).then((d) => { if (d.user) setMe({ avatarUrl: d.user.avatarUrl }) }).catch(() => {})
  }, [user])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()

  return (
    <button
      onClick={() => setOpen(!open)}
      className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-accent cursor-pointer tap-44 relative"
      aria-label={tr('Account', 'Tài khoản')}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      {me?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={me.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-2xs font-bold text-white">{initial}</span>
      )}
    </button>
  )
}

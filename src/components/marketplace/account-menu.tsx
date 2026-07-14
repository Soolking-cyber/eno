'use client'

import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
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

  return (
    <IconButton
      size="md"
      onClick={() => setOpen(!open)}
      className="transition-colors hover:bg-accent"
      aria-label={tr('Account', 'Tài khoản')}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <Avatar url={me?.avatarUrl} name={user.email || user.phone || '?'} size="sm" className="h-7 w-7" />
    </IconButton>
  )
}

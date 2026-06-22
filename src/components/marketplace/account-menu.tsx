'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Heart, MessageSquare, Store, LogOut, Monitor, Sun, Moon } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useTheme } from '@/context/theme-context'
import { cn } from '@/lib/utils'

type Me = { displayName: string | null; email: string | null; avatarUrl: string | null; avatarColor: string; sellerId: string | null }

/** Header avatar → dropdown menu (no page redirect). */
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const { tr, lang, setLang } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Instant paint: seed the avatar/name from the cached dashboard profile so the
  // header isn't blank, then revalidate identity from /api/me in the background.
  useEffect(() => {
    if (!user) { setMe(null); return }
    try {
      const c = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
      if (c?.userId === user.id && c.dashboard?.profile) {
        const p = c.dashboard.profile
        setMe({ displayName: p.displayName, email: p.email, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor, sellerId: c.dashboard.seller?.id ?? null })
      }
    } catch {}
    fetch('/api/me').then((r) => r.json()).then((d) => { if (d.user) setMe(d.user) }).catch(() => {})
  }, [user])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
        aria-label={tr('Account', 'Tài khoản')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {me?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0a66c2] text-[11px] font-bold text-white">{initial}</span>
        )}
        <span className="hidden lg:inline">{tr('Account', 'Tài khoản')}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="border-b border-border px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-bold text-foreground">{me?.displayName || user.email || user.phone}</p>
            {me?.email && <p className="truncate text-xs text-ink-4">{me.email}</p>}
          </div>
          <div className="pt-1">
            <Link href="/dashboard" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Store className="h-4 w-4 text-accent-foreground" /> {tr('Account & listings', 'Tài khoản & tin đăng')}
            </Link>
            <Link href="/saved" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Heart className="h-4 w-4 text-accent-foreground" /> {tr('Saved listings', 'Tin đã lưu')}
            </Link>
            <Link href="/messages" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <MessageSquare className="h-4 w-4 text-accent-foreground" /> {tr('Messages', 'Tin nhắn')}
            </Link>

            {/* Language (left, compact dropdown) + theme (right, icon segmented) — one line */}
            <div className="mt-1 flex items-center gap-2 border-t border-border px-1.5 pb-1 pt-2">
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as typeof lang)}
                aria-label={tr('Language', 'Ngôn ngữ')}
                className="min-w-0 flex-1 cursor-pointer rounded-lg border border-border bg-card py-1.5 pl-2 pr-1 text-xs font-medium text-body outline-none transition-colors hover:bg-muted focus:border-ring"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.native}</option>
                ))}
              </select>
              <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
                {([['system', Monitor, tr('System', 'Hệ thống')], ['light', Sun, tr('Light', 'Sáng')], ['dark', Moon, tr('Dark', 'Tối')]] as const).map(([val, Icon, label]) => (
                  <button
                    key={val}
                    role="menuitemradio"
                    aria-checked={theme === val}
                    title={label}
                    aria-label={label}
                    onClick={() => setTheme(val)}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer',
                      theme === val ? 'bg-card text-accent-foreground shadow-sm' : 'text-ink-4 hover:text-body',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-1 border-t border-border pt-1">
              <button role="menuitem" onClick={() => { setOpen(false); signOut() }} className={`${item} hover:bg-destructive/10 hover:text-destructive`}>
                <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

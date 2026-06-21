'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { User, Heart, MessageSquare, Store, LogOut, Check } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { cn } from '@/lib/utils'

type Me = { displayName: string | null; email: string | null; avatarUrl: string | null; avatarColor: string; sellerId: string | null }

/** Header avatar → dropdown menu (no page redirect). */
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const { tr, lang, setLang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Load identity (incl. owned storefront) when the menu first opens.
  useEffect(() => {
    if (!open || me) return
    fetch('/api/me').then((r) => r.json()).then((d) => setMe(d.user ?? null)).catch(() => {})
  }, [open, me])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-xl px-2.5 h-9 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
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
        <div role="menu" className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-slate-100 bg-white p-1.5 shadow-lg animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="border-b border-slate-100 px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-bold text-[#1a202c]">{me?.displayName || user.email || user.phone}</p>
            {me?.email && <p className="truncate text-xs text-[#94a3b8]">{me.email}</p>}
          </div>
          <div className="pt-1">
            {me?.sellerId && (
              <Link href={`/sellers/${me.sellerId}`} role="menuitem" onClick={() => setOpen(false)} className={item}>
                <Store className="h-4 w-4 text-[#0a66c2]" /> {tr('My business profile', 'Hồ sơ doanh nghiệp')}
              </Link>
            )}
            <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <User className="h-4 w-4 text-[#0a66c2]" /> {tr('My listings', 'Tin của tôi')}
            </Link>
            <Link href="/saved" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Heart className="h-4 w-4 text-[#0a66c2]" /> {tr('Saved listings', 'Tin đã lưu')}
            </Link>
            <Link href="/messages" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <MessageSquare className="h-4 w-4 text-[#0a66c2]" /> {tr('Messages', 'Tin nhắn')}
            </Link>

            {/* Language — switch instantly without leaving the menu */}
            <div className="mt-1 border-t border-slate-100 px-1 pb-1 pt-2">
              <p className="mb-1.5 px-1.5 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">{tr('Language', 'Ngôn ngữ')}</p>
              <div className="grid grid-cols-2 gap-1">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    role="menuitemradio"
                    aria-checked={lang === l.code}
                    onClick={() => setLang(l.code)}
                    className={cn(
                      'flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer',
                      lang === l.code ? 'bg-[#e8f1fb] font-semibold text-[#0a66c2]' : 'text-[#475569] hover:bg-slate-50',
                    )}
                  >
                    <span className="truncate">{l.native}</span>
                    {lang === l.code && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-1 border-t border-slate-100 pt-1">
              <button role="menuitem" onClick={() => { setOpen(false); signOut() }} className={`${item} hover:bg-red-50 hover:text-red-600`}>
                <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

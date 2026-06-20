'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { SlidersHorizontal, Plus, Heart, User, Globe, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'

export function Header() {
  const { lang, setLang, t, tr } = useLanguage()
  const { count } = useFavorites()
  const { user, signOut, openSignIn } = useAuth()
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement>(null)
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/60 dark:border-slate-800/40 bg-card">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center">
          <img src="/logo.svg" alt="ENO" className="h-10 w-auto" />
        </Link>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Language Selector (5 languages) */}
          <div className="relative" ref={langRef}>
            <button
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white/80 px-2.5 h-9 text-xs font-bold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
              aria-label={tr('Language')}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
            >
              <Globe className="h-4 w-4" />
              <span>{current.label}</span>
              <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', langOpen && 'rotate-180')} />
            </button>
            {langOpen && (
              <div
                role="listbox"
                className="absolute right-0 top-full mt-1.5 z-50 w-40 rounded-xl border border-slate-100 bg-white p-1 shadow-lg animate-in fade-in slide-in-from-top-1 duration-100"
              >
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    role="option"
                    aria-selected={lang === l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false) }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors cursor-pointer',
                      lang === l.code ? 'bg-[#e8f1fb] text-[#0a66c2] font-bold' : 'text-[#1a202c] hover:bg-slate-50',
                    )}
                  >
                    <span>{l.native}</span>
                    <span className="text-[10px] font-bold text-[#94a3b8]">{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* FINN-style account cluster */}
          <Link
            href="/saved"
            className="relative hidden sm:flex h-9 w-9 items-center justify-center rounded-full text-[#475569] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
            aria-label={tr('Saved', 'Tin đã lưu')}
          >
            <Heart className={cn('h-5 w-5', count > 0 && 'fill-[#0a66c2] text-[#0a66c2]')} />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
          {user ? (
            <button
              onClick={() => signOut()}
              className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 h-9 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
              title={user.email || user.phone || ''}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0a66c2] text-[11px] font-bold text-white">
                {(user.email || user.phone || '?').charAt(0).toUpperCase()}
              </span>
              <span className="hidden lg:inline">{tr('Sign out', 'Đăng xuất')}</span>
            </button>
          ) : (
            <button
              onClick={openSignIn}
              className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 h-9 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-5 w-5" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </button>
          )}

          <Link
            href="/post"
            className="hidden items-center gap-1.5 rounded-full bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#004182] sm:flex cursor-pointer"
          >
            <Plus className="h-4 w-4" /> {t('header.postBtn')}
          </Link>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-mobile-filters'))
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e2e8f0] bg-white/80 text-[#475569] md:hidden cursor-pointer"
            aria-label={tr('Filter')}
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  )
}

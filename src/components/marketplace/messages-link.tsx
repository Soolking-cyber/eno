'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

function useUnread(): number {
  const { user } = useAuth()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!user) { setN(0); return }
    let active = true
    const poll = () => fetch('/api/conversations/unread').then((r) => r.json()).then((d) => { if (active) setN(d.unread ?? 0) }).catch(() => {})
    poll()
    const iv = setInterval(poll, 15000)
    const onFocus = () => poll()
    window.addEventListener('focus', onFocus)
    return () => { active = false; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [user])
  return n
}

/** Header (desktop) Messages icon + unread badge. Hidden when logged out. */
export function MessagesHeaderLink() {
  const { user } = useAuth()
  const { tr } = useLanguage()
  const unread = useUnread()
  if (!user) return null
  return (
    <Link
      href="/messages"
      aria-label={tr('Messages', 'Tin nhắn')}
      className="relative hidden sm:flex h-9 w-9 items-center justify-center rounded-full text-[#475569] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
    >
      <MessageSquare className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}

/** Mobile bottom-nav Messages tab + unread badge. */
export function MessagesMobileLink({ itemCls }: { itemCls: (active: boolean) => string }) {
  const { user } = useAuth()
  const { tr } = useLanguage()
  const pathname = usePathname()
  const unread = useUnread()
  if (!user) return null
  return (
    <Link href="/messages" className={itemCls(pathname?.startsWith('/messages') ?? false)}>
      <span className="relative">
        <MessageSquare className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </span>
      <span className={cn('truncate')}>{tr('Messages', 'Tin nhắn')}</span>
    </Link>
  )
}

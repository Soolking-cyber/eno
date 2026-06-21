'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, MessageSquare, Tag } from 'lucide-react'
import { useNotifications } from '@/context/notifications-context'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Notification bell for the header (desktop + mobile). Badge shows unread count;
 *  opening the panel marks everything read. Each row deep-links to the thread/listing. */
export function NotificationBell() {
  const { user, openSignIn } = useAuth()
  const { items, unread, markAllRead } = useNotifications()
  const { tr, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const toggle = () => {
    if (!user) { openSignIn(); return }
    const next = !open
    setOpen(next)
    if (next && unread > 0) markAllRead()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={tr('Notifications', 'Thông báo')}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
      >
        <Bell className="h-5 w-5" />
        {user && unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-bold text-[#1a202c]">{tr('Notifications', 'Thông báo')}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            {items.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-[#94a3b8]">{tr('No notifications yet.', 'Chưa có thông báo.')}</p>
            ) : (
              items.map((n) => {
                const href = n.conversationId ? `/messages/${n.conversationId}` : n.listingId ? `/listings/${n.listingId}` : '#'
                const Icon = n.type === 'offer' ? Tag : MessageSquare
                return (
                  <Link
                    key={n.id}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn('flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50', !n.read && 'bg-[#f5f9ff]')}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0a66c2]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-[#1a202c]">
                          {n.type === 'offer' ? tr('New offer', 'Đề nghị mới') : n.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-[#94a3b8]">{timeAgo(n.createdAt, lang === 'vi' ? 'vi' : 'en')}</span>
                      </div>
                      {n.body && <p className="truncate text-xs text-[#64748b]">{n.body}</p>}
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

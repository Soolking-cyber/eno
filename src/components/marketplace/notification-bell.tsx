'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, MessageSquare, Tag, Clock, Search, X } from 'lucide-react'
import { useNotifications } from '@/context/notifications-context'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Notification bell for the header (desktop + mobile). Badge shows unread count;
 *  opening the panel marks everything read. Each row deep-links to the thread/listing. */
export function NotificationBell() {
  const { user, openSignIn } = useAuth()
  const { items, unread, markAllRead, remove, clearAll } = useNotifications()
  const { tr, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false) // 2-tap guard on "Clear all"
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Reset the clear-all confirm whenever the panel closes (avoids a stale armed state).
  useEffect(() => { if (!open) setConfirmClear(false) }, [open])

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
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
      >
        <Bell className="h-5 w-5" />
        {user && unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-card shadow-pop animate-in fade-in duration-150">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-bold text-foreground">{tr('Notifications', 'Thông báo')}</span>
            {items.length > 0 && (
              <button
                onClick={() => { if (confirmClear) { clearAll(); setConfirmClear(false) } else setConfirmClear(true) }}
                className={cn('text-xs font-semibold transition-colors cursor-pointer', confirmClear ? 'text-red-500' : 'text-ink-4 hover:text-accent-foreground')}
              >
                {confirmClear ? tr('Tap to delete all', 'Nhấn để xóa hết') : tr('Clear all', 'Xóa tất cả')}
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            {items.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-ink-4">{tr('No notifications yet.', 'Chưa có thông báo.')}</p>
            ) : (
              items.map((n) => {
                const href = n.url ? n.url : n.type === 'reminder' ? '/dashboard' : n.conversationId ? `/messages/${n.conversationId}` : n.listingId ? `/listings/${n.listingId}` : '#'
                const Icon = n.type === 'offer' ? Tag : n.type === 'reminder' ? Clock : n.type === 'saved_search' ? Search : MessageSquare
                return (
                  <div key={n.id} className={cn('group relative transition-colors hover:bg-muted', !n.read && 'bg-accent')}>
                    <Link href={href} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 pr-10">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {n.type === 'offer' ? tr('New offer', 'Đề nghị mới') : n.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-ink-4">{timeAgo(n.createdAt, lang === 'vi' ? 'vi' : 'en')}</span>
                        </div>
                        {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                      </div>
                    </Link>
                    {/* Delete — reveals on hover (desktop); always visible on touch */}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(n.id) }}
                      aria-label={tr('Delete notification', 'Xóa thông báo')}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-4 opacity-0 transition-opacity hover:bg-accent hover:text-foreground cursor-pointer group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

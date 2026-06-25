'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, MessageSquare, Tag, Clock, Search, X } from 'lucide-react'
import { useNotifications } from '@/context/notifications-context'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Notification bell for the header (desktop + mobile). Badge shows unread count.
 *  Unread float to the top and stay highlighted; each row is marked read when
 *  opened (or all at once via "Mark all read"). Each row deep-links to the thread/listing. */
export function NotificationBell() {
  const { user, openSignIn } = useAuth()
  const { items, unread, markRead, markAllRead, remove, clearAll } = useNotifications()
  const { tr, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false) // 2-tap guard on "Clear all"
  const ref = useRef<HTMLDivElement>(null)

  // Unread float to the top (newest first), read sink below — like an inbox. Opening
  // the panel does NOT mark everything read (so the distinction survives); each item
  // is marked read when opened, or all at once via "Mark all read".
  const sorted = [...items].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

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
    setOpen((o) => !o)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={tr('Notifications', 'Thông báo')}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
      >
        {/* Match the bottom-nav icon size on mobile (28px) for top↔bottom symmetry;
            stay 20px on desktop where it sits beside the 20px Saved/Messages icons. */}
        <Bell className="h-7 w-7 sm:h-5 sm:w-5" />
        {user && unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-card shadow-pop animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-bold text-foreground">{tr('Notifications', 'Thông báo')}</span>
            <div className="flex shrink-0 items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="whitespace-nowrap text-xs font-semibold text-ink-4 transition-colors hover:text-accent-foreground cursor-pointer"
                >
                  {tr('Mark all read', 'Đánh dấu đã đọc')}
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={() => { if (confirmClear) { clearAll(); setConfirmClear(false) } else setConfirmClear(true) }}
                  className={cn('whitespace-nowrap text-xs font-semibold transition-colors cursor-pointer', confirmClear ? 'text-red-500' : 'text-ink-4 hover:text-accent-foreground')}
                >
                  {confirmClear ? tr('Tap to delete all', 'Nhấn để xóa hết') : tr('Clear all', 'Xóa tất cả')}
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            {items.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-ink-4">{tr('No notifications yet.', 'Chưa có thông báo.')}</p>
            ) : (
              sorted.map((n) => {
                const href = n.url ? n.url : n.type === 'reminder' ? '/dashboard' : n.conversationId ? `/messages/${n.conversationId}` : n.listingId ? `/listings/${n.listingId}` : '#'
                const Icon = n.type === 'offer' ? Tag : n.type === 'reminder' ? Clock : n.type === 'saved_search' ? Search : MessageSquare
                return (
                  // Unread = brand-tinted with a left rail + dot; read = plain. Opening
                  // a notification marks just it read (so it sinks below on next view).
                  <div key={n.id} className={cn('group relative transition-colors', n.read ? 'hover:bg-muted' : 'bg-accent/60 hover:bg-accent')}>
                    {!n.read && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent-foreground" />}
                    <Link
                      href={href}
                      onClick={() => {
                        markRead(n.id); setOpen(false)
                        // Home-filter deep-links (saved-search alerts → `/?<filters>`) are a
                        // soft nav the in-page explorer can't see when we're already on `/`;
                        // tell it to apply the filters. Harmless on other routes (no listener).
                        if (href.startsWith('/?')) window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: href } }))
                      }}
                      className="flex gap-3 px-4 py-3 pr-10"
                    >
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', n.read ? 'bg-muted text-ink-4' : 'bg-accent text-accent-foreground')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('flex min-w-0 items-center gap-1.5 truncate text-sm', n.read ? 'font-medium text-body' : 'font-bold text-foreground')}>
                            {!n.read && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent-foreground" />}
                            <span className="truncate">{n.type === 'offer' ? tr('New offer', 'Đề nghị mới') : n.title}</span>
                          </span>
                          <span className="shrink-0 text-[10px] text-ink-4">{timeAgo(n.createdAt, lang === 'vi' ? 'vi' : 'en')}</span>
                        </div>
                        {n.body && <p className={cn('truncate text-xs', n.read ? 'text-muted-foreground' : 'text-body')}>{n.body}</p>}
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

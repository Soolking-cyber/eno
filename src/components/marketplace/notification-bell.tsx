'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, MessageSquare, Tag, Clock, Search, Sparkles, Scale, X, TrendingDown, ShieldCheck } from "@/components/ui/icons"
import { STROKE_NAV } from '@/lib/icon-tokens'
import { useNotifications } from '@/context/notifications-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/context/auth-context'
import { useLanguage, Tr } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Notification bell for the header (desktop + mobile). Badge shows unread count.
 *  Unread float to the top and stay highlighted; each row is marked read when
 *  opened (or all at once via "Mark all read"). Each row deep-links to the thread/listing.
 *
 *  Base UI Popover (ui/popover) owns the floating layer: it gives the trigger
 *  aria-expanded/haspopup/controls, Escape-to-close, focus move-in + return, portaling
 *  (so the panel escapes the sticky header's stacking context), outside-dismiss, and the
 *  exit animation — all of which the old hand-rolled useState + document-mousedown panel
 *  lacked. */
export function NotificationBell() {
  const { user, openSignIn } = useAuth()
  const { items, unread, markRead, markAllRead, remove, clearAll } = useNotifications()
  const { tr, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false) // 2-tap guard on "Clear all"

  // Unread float to the top (newest first), read sink below — like an inbox. Opening
  // the panel does NOT mark everything read (so the distinction survives); each item
  // is marked read when opened, or all at once via "Mark all read".
  const sorted = [...items].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  // Reset the clear-all confirm whenever the panel closes (avoids a stale armed state).
  useEffect(() => { if (!open) setConfirmClear(false) }, [open])

  return (
    <Popover
      open={open}
      // Auth gate lives here, not on a trigger onClick: when a signed-out visitor presses
      // the bell, Base UI asks to open (next === true) — we send them to sign-in instead and
      // never flip `open`, so the popover stays closed. Signed-in taps toggle normally.
      onOpenChange={(next) => {
        if (next && !user) { openSignIn(); return }
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <IconButton
            size="lg"
            aria-label={user && unread > 0 ? tr('Notifications, {n} unread', 'Thông báo, {n} chưa đọc').replace('{n}', String(unread)) : tr('Notifications', 'Thông báo')}
            // active:scale-[0.96] is safe on this popover anchor: Base UI opens on `click` (fires after
            // pointerup, i.e. after :active releases), so floating-ui measures the rect at scale-100
            // and autoUpdate never re-reads on a transform — the panel is never placed off a pressed rect.
            className="text-body transition-[background-color,color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
          >
            {/* 28px everywhere — matches the bottom-nav icons on mobile and the
                Saved/Messages action icons on desktop (one consistent nav scale).
                STROKE_NAV: the bell is h-7 header chrome (§2 — it was the one chrome
                glyph in the header still on lucide's default 2). The solid fill-brand
                when unread is USER-state (§5) — something is yours/waiting. */}
            <Bell className={cn('h-7 w-7', user && unread > 0 && 'fill-brand text-brand')} strokeWidth={STROKE_NAV} />
            {user && unread > 0 && (
              <Badge aria-hidden variant="counter" size="count" className="absolute right-1 top-1 animate-in zoom-in duration-200">
                {unread > 9 ? '9+' : unread}
              </Badge>
            )}
          </IconButton>
        }
      />

      {/* side=bottom align=end anchors the desktop dropdown under the bell. On mobile the width
          is calc(100vw-1rem), so Base UI's shift() collision middleware clamps it into the
          viewport with ~8px gutters — a full-bleed sheet WITHOUT position:fixed. (A max-sm:fixed
          override can't span the viewport here: the Positioner carries floating-ui's inline
          transform, making it the containing block for any fixed child, so insets would resolve
          against that tiny box, not the screen.) p-0/gap-0 + overflow-hidden restore the
          edge-to-edge rows and clip them to the rounded corners. */}
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        aria-label={tr('Notifications', 'Thông báo')}
        className="w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0 shadow-pop ring-0 sm:w-80"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-bold text-foreground">{tr('Notifications', 'Thông báo')}</span>
          <div className="flex shrink-0 items-center gap-3">
            {unread > 0 && (
              <Button
                variant="bare"
                size="none"
                onClick={() => markAllRead()}
                className="text-xs font-semibold text-ink-4 transition-colors hover:text-accent-foreground cursor-pointer"
              >
                {tr('Mark all read', 'Đánh dấu đã đọc')}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="bare"
                size="none"
                onClick={() => { if (confirmClear) { clearAll(); setConfirmClear(false) } else setConfirmClear(true) }}
                className={cn('text-xs font-semibold transition-colors cursor-pointer', confirmClear ? 'text-destructive' : 'text-ink-4 hover:text-accent-foreground')}
              >
                {confirmClear ? tr('Tap to delete all', 'Nhấn để xóa hết') : tr('Clear all', 'Xóa tất cả')}
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto scroll-thin">
          {items.length === 0 ? (
            // Compact designed empty state (popover-scale) — says what lands here
            // and points somewhere useful, instead of a bare one-liner.
            <div className="px-6 py-10 text-center">
              {/* The chrome coin (§6) at popover scale — same brand-50 disc as ui/empty-state's
                  badge, so "nothing here yet" stays in the blue family instead of a gray void.
                  20px glyph keeps the UI stroke (display-tier 1.5 only thins h-8+ artwork). */}
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand">
                <Bell className="h-5 w-5" />
              </span>
              <p className="mx-auto mt-3 max-w-[15rem] text-sm text-ink-4">
                {tr('Alerts for saved searches, offers and replies land here', 'Thông báo tìm kiếm đã lưu, trả giá và phản hồi sẽ hiện ở đây')}
              </p>
              <Link
                href="/saved"
                onClick={() => setOpen(false)}
                className="mt-3 inline-block text-xs font-semibold text-accent-foreground hover:underline"
              >
                {tr('View saved items', 'Xem tin đã lưu')}
              </Link>
            </div>
          ) : (
            sorted.map((n) => {
              const href = n.url ? n.url : n.type === 'reminder' ? '/dashboard/availability' : n.conversationId ? `/messages/${n.conversationId}` : n.listingId ? `/listings/${n.listingId}` : '#'
              // 'system' = an official admin→user message, i.e. eno itself speaking — a genuine
              // first-party moment, so it carries the eno seal (icon-language §0b: the signature
              // echo, reserved for first-party trust; every other type keeps its lucide verb).
              const Icon = n.type === 'system' ? ShieldCheck : n.type === 'offer' ? Tag : n.type === 'price_drop' ? TrendingDown : n.type === 'reminder' ? Clock : n.type === 'saved_search' ? Search : n.type === 'milestone' ? Sparkles : n.type === 'dispute' ? Scale : MessageSquare
              return (
                // Unread = brand-tinted with a dot; read = plain. Opening a notification marks
                // just it read (so it sinks below on next view).
                //
                // ⚠️ THE LEFT RAIL IS GONE ON PURPOSE (owner, 2026-08-13: "remove this blue line on
                // notif dropdown") — it was a `w-1 bg-accent-foreground` bar down the row's left
                // edge. Unread is still carried twice over, by the row's `bg-accent/60` tint and by
                // the dot beside the title, so removing the third mark costs no signal: a full-bleed
                // saturated bar is simply louder than "you have not read this yet" needs to be, and
                // it fought the tint it sat on. `relative` stays — the row still positions the
                // dismiss control at `pr-10`.
                <div key={n.id} className={cn('group relative transition-colors', n.read ? 'hover:bg-muted' : 'bg-accent/60 hover:bg-accent')}>
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
                          <span className="truncate">{n.type === 'offer' ? tr('New offer', 'Đề nghị mới') : n.type === 'price_drop' ? tr('Price drop', 'Giảm giá') : n.type === 'milestone' ? tr('First interested buyer!', 'Người mua đầu tiên quan tâm!') : <Tr text={n.title} />}</span>
                        </span>
                        <span className="shrink-0 text-3xs text-ink-4">{timeAgo(n.createdAt, lang === 'vi' ? 'vi' : 'en')}</span>
                      </div>
                      {n.body && <p className={cn('text-xs', n.type === 'system' ? 'line-clamp-3 whitespace-pre-wrap' : 'truncate', n.read ? 'text-muted-foreground' : 'text-body')}><Tr text={n.body} /></p>}
                    </div>
                  </Link>
                  {/* Delete — reveals on hover (desktop); always visible on touch */}
                  <IconButton
                    size="xs"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(n.id) }}
                    aria-label={tr('Delete notification', 'Xóa thông báo')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Search, Trash2, X, Sparkles } from 'lucide-react'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

// Borderless conversation list — the left pane of the desktop two-pane messenger
// (and the whole screen on mobile). Highlights the open thread on desktop.
export function ConversationList() {
  const { user, loading } = useAuth()
  const { lang, tr } = useLanguage()
  const { convos, deleteConvo, refreshConvos, prefetchThread } = useChat()
  const { id: activeId } = useParams<{ id?: string }>()
  const pathname = usePathname()
  const aiActive = pathname === '/messages/ai'
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => { if (user) refreshConvos() }, [user, refreshConvos])

  const filtered = useMemo(() => {
    if (!convos) return convos
    const q = query.trim().toLowerCase()
    // Stable newest-first order (`convos` is already recency-sorted). We deliberately
    // do NOT re-sort by unread/active: doing so made the clicked thread jump to the
    // top of the list (and an unread thread jump down the instant opening it marked it
    // read). Unread threads are already unmistakable via the blue rail + count badge +
    // accent background, so opening a conversation now leaves the list order untouched —
    // only genuinely new activity (a fresh message bumping recency) reorders it.
    return q
      ? convos.filter((c) => `${c.counterpart.name} ${c.listingTitle} ${c.lastMessageText ?? ''}`.toLowerCase().includes(q))
      : convos
  }, [convos, query])

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-3">
        {/* Title only on desktop; on mobile the navbar gives context + the search
            sits right under it. */}
        <h1 className="h-title text-foreground px-1 hidden lg:block">{tr('Messages', 'Tin nhắn')}</h1>
        {/* Search — filled, borderless */}
        <div className="relative lg:mt-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <Input
            variant="filled"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Search messages', 'Tìm tin nhắn')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            aria-label={tr('Search messages', 'Tìm tin nhắn')}
            className="py-2.5 pl-10 pr-4 transition-colors focus:bg-muted focus:ring-0"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4 scroll-thin">
        {/* eno AI — pinned at the top; always available (a chat with the AI assistant). */}
        <Link
          href="/messages/ai"
          scroll={false}
          className={cn('mb-1 flex items-center gap-3 rounded-xl p-2.5 transition-colors', aiActive ? 'bg-muted text-accent-foreground' : 'hover:bg-muted')}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Sparkles className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-foreground">{tr('eno AI', 'eno AI')}</span>
            <p className="truncate text-xs text-accent-foreground">{tr('Ask anything — find products by chat', 'Hỏi bất cứ điều gì — tìm đồ bằng chat')}</p>
          </div>
        </Link>
        {!loading && !user ? (
          <div className="px-2 py-10 text-center">
            <Mascot name="chat" className="mx-auto h-40 w-40" />
            <p className="mt-3 text-sm text-muted-foreground">{tr('Sign in to see your messages.', 'Đăng nhập để xem tin nhắn của bạn.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : convos === null ? (
          <div className="space-y-1.5 px-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : convos.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <Mascot name="chat" className="mx-auto h-40 w-40" />
            <p className="mt-3 text-sm text-ink-4">{tr('No messages yet. Tap "Message" on a listing to start a chat.', 'Chưa có tin nhắn. Nhấn "Nhắn tin" trên một tin đăng để bắt đầu.')}</p>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <p className="px-3 py-12 text-center text-sm text-ink-4">{tr('No conversations match.', 'Không có cuộc trò chuyện phù hợp.')}</p>
        ) : (
          <div className="space-y-0.5">
            {(filtered ?? []).map((c) => (
              <div
                key={c.id}
                onMouseEnter={() => prefetchThread(c.id)}
                onTouchStart={() => prefetchThread(c.id)}
                className={cn('group relative flex items-center gap-1 rounded-xl transition-colors', activeId === c.id ? 'text-accent-foreground bg-muted' : c.unread > 0 ? 'bg-accent hover:bg-accent' : 'hover:bg-muted')}
              >
                {/* Unread → clear blue left rail so the new thread to reply to stands out. */}
                {c.unread > 0 && activeId !== c.id && (
                  <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-accent-foreground" />
                )}
                <Link href={`/messages/${c.id}`} scroll={false} className="flex min-w-0 flex-1 items-center gap-3 p-2.5">
                  <Avatar name={c.counterpart.name} url={c.counterpart.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-foreground">{c.counterpart.name}</span>
                      {c.unread > 0 && <Badge variant="counter-brand" size="count" className="h-5 min-w-5 px-1.5">{c.unread}</Badge>}
                    </div>
                    {/* ⚠️ THE LABEL EXISTS BECAUSE THE COUNTERPART NAME CANNOT DISTINGUISH THESE.
                        The visa desk and the trip desk are ONE Seller row, so both threads show the
                        identical "eno Vietnam" and the same avatar — measured: 6 of 23 live
                        conversations. Without this a traveller has no way to tell their passport
                        application from their holiday plan in the list. The kind comes from the
                        server's threadKind; 'listing' (an ordinary marketplace chat) gets no badge,
                        because there is nothing to disambiguate. */}
                    <div className="flex min-w-0 items-center gap-1.5">
                      {(c.kind === 'visa' || c.kind === 'itinerary') && (
                        <Badge size="sm" className="shrink-0 bg-tint text-body">
                          {c.kind === 'visa' ? tr('Visa', 'Thị thực') : tr('Trip', 'Chuyến đi')}
                        </Badge>
                      )}
                      <p className="truncate text-xs text-ink-4">{c.listingTitle}</p>
                    </div>
                    {(() => {
                      const o = c.lastOffer
                      // Make offer direction + status legible at a glance: an incoming
                      // pending offer ("New offer") is the actionable one and stands out.
                      const amt = o ? formatMoneyFull(o.amount || 0, '₫', moneyLocale(lang)) : ''
                      const label = o
                        ? o.status === 'accepted' ? tr('✅ Offer accepted', '✅ Đã chấp nhận đề nghị')
                          : o.status === 'declined' ? tr('❌ Offer declined', '❌ Đã từ chối đề nghị')
                          : o.status === 'countered' ? tr('↩️ Counter-offer', '↩️ Đã trả giá khác')
                          : o.mine ? `${tr('You offered', 'Bạn đề nghị')} ${amt}`
                          : `💰 ${tr('New offer', 'Đề nghị mới')}: ${amt}`
                        : (c.lastMessageText || tr('New conversation', 'Cuộc trò chuyện mới'))
                      const incoming = !!o && o.status === 'pending' && !o.mine
                      return <p className={cn('truncate text-xs', incoming ? 'font-bold text-accent-foreground' : c.unread > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{label}</p>
                    })()}
                  </div>
                </Link>
                {confirmId === c.id ? (
                  <div className="flex shrink-0 items-center gap-1 pr-2 pl-1">
                    <Button variant="destructive" size="none" onClick={() => { deleteConvo(c.id); setConfirmId(null) }} className="cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold text-white active:scale-[0.96]">{tr('Delete', 'Xóa')}</Button>
                    <IconButton size="xs" onClick={() => setConfirmId(null)} aria-label={tr('Cancel', 'Hủy')} className="text-ink-4 hover:text-foreground"><X className="h-4 w-4" /></IconButton>
                  </div>
                ) : (
                  <IconButton
                    size="sm"
                    onClick={() => setConfirmId(c.id)}
                    aria-label={tr('Delete conversation', 'Xóa cuộc trò chuyện')}
                    className="mr-2 ml-1 text-ink-4 opacity-100 transition hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

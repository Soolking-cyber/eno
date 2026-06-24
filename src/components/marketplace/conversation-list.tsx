'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Search, Trash2, X } from 'lucide-react'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'

// Borderless conversation list — the left pane of the desktop two-pane messenger
// (and the whole screen on mobile). Highlights the open thread on desktop.
export function ConversationList() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { convos, deleteConvo, refreshConvos, prefetchThread } = useChat()
  const { id: activeId } = useParams<{ id?: string }>()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => { if (user) refreshConvos() }, [user, refreshConvos])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !convos) return convos
    return convos.filter((c) => `${c.counterpart.name} ${c.listingTitle} ${c.lastMessageText ?? ''}`.toLowerCase().includes(q))
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
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Search messages', 'Tìm tin nhắn')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            aria-label={tr('Search messages', 'Tìm tin nhắn')}
            className="w-full rounded-xl bg-tint py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:bg-muted"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4 scroll-thin">
        {!loading && !user ? (
          <div className="px-2 py-10 text-center">
            <Mascot name="chat" className="mx-auto h-40 w-40" />
            <p className="mt-3 text-sm text-muted-foreground">{tr('Sign in to see your messages.', 'Đăng nhập để xem tin nhắn của bạn.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : convos === null ? (
          <div className="space-y-1.5 px-1">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl shimmer" />)}</div>
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
                className={cn('group flex items-center gap-1 rounded-xl transition-colors', activeId === c.id ? 'text-accent-foreground' : 'hover:bg-muted')}
              >
                <Link href={`/messages/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-2.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0a66c2] text-sm font-bold text-white">
                    {c.counterpart.avatarUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.counterpart.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                      : c.counterpart.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-foreground">{c.counterpart.name}</span>
                      {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0a66c2] px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-ink-4">{c.listingTitle}</p>
                    {(() => {
                      const o = c.lastOffer
                      // Make offer direction + status legible at a glance: an incoming
                      // pending offer ("New offer") is the actionable one and stands out.
                      const amt = o ? `${new Intl.NumberFormat('en-US').format(o.amount || 0)}₫` : ''
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
                    <button onClick={() => { deleteConvo(c.id); setConfirmId(null) }} className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95">{tr('Delete', 'Xóa')}</button>
                    <button onClick={() => setConfirmId(null)} aria-label={tr('Cancel', 'Hủy')} className="rounded-full p-1.5 text-ink-4 hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(c.id)}
                    aria-label={tr('Delete conversation', 'Xóa cuộc trò chuyện')}
                    className="mr-2 ml-1 shrink-0 rounded-full p-2 text-ink-4 opacity-100 transition hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { MessageSquare, Search, Trash2, X } from 'lucide-react'

export default function MessagesPage() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  // Read the already-preloaded + localStorage-cached inbox (same source the chat
  // used to be) so this full page paints instantly; revalidate on visit.
  const { convos, deleteConvo, refreshConvos } = useChat()
  const [confirmId, setConfirmId] = useState<string | null>(null) // row showing the Delete confirm
  const [query, setQuery] = useState('')

  useEffect(() => { if (user) refreshConvos() }, [user, refreshConvos])

  // Client-side filter by counterpart, listing, or last message.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !convos) return convos
    return convos.filter((c) =>
      `${c.counterpart.name} ${c.listingTitle} ${c.lastMessageText ?? ''}`.toLowerCase().includes(q),
    )
  }, [convos, query])

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="h-title text-[#1a202c] mb-6">{tr('Messages', 'Tin nhắn')}</h1>

        {!loading && !user ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-pop">
            <MessageSquare className="mx-auto h-10 w-10 text-[#cbd5e1]" />
            <p className="mt-3 text-sm text-[#64748b]">{tr('Sign in to see your messages.', 'Đăng nhập để xem tin nhắn của bạn.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : convos === null ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}</div>
        ) : convos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#cbd5e1] py-16 text-center text-sm text-[#94a3b8]">
            {tr('No messages yet. Tap "Message" on a listing to start a chat.', 'Chưa có tin nhắn. Nhấn "Nhắn tin" trên một tin đăng để bắt đầu.')}
          </div>
        ) : (
          <>
            {/* Search bar (flat, on-canvas) */}
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('Search messages', 'Tìm tin nhắn')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label={tr('Search messages', 'Tìm tin nhắn')}
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-[#1a202c] outline-none transition-colors focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20 placeholder:text-[#94a3b8]"
              />
            </div>

            {filtered && filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-[#94a3b8]">{tr('No conversations match.', 'Không có cuộc trò chuyện phù hợp.')}</p>
            ) : (
              <div className="overflow-hidden rounded-2xl bg-white shadow-pop">
                <div className="divide-y divide-slate-100">
                {(filtered ?? []).map((c) => (
                  <div key={c.id} className="group flex items-center gap-1 transition-colors hover:bg-slate-50">
                    <Link href={`/messages/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0a66c2] text-sm font-bold text-white">
                        {c.counterpart.avatarUrl
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.counterpart.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                          : c.counterpart.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold text-[#1a202c]">{c.counterpart.name}</span>
                          {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0a66c2] px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                        </div>
                        <p className="truncate text-xs text-[#94a3b8]">{c.listingTitle}</p>
                        <p className={`truncate text-xs ${c.unread > 0 ? 'font-semibold text-[#1a202c]' : 'text-[#64748b]'}`}>{c.lastMessageText || tr('New conversation', 'Cuộc trò chuyện mới')}</p>
                      </div>
                    </Link>
                    {/* Delete conversation: tap trash → Delete/Cancel confirm. */}
                    {confirmId === c.id ? (
                      <div className="flex shrink-0 items-center gap-1 pr-2 pl-1">
                        <button onClick={() => { deleteConvo(c.id); setConfirmId(null) }} className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95">{tr('Delete', 'Xóa')}</button>
                        <button onClick={() => setConfirmId(null)} aria-label={tr('Cancel', 'Hủy')} className="rounded-full p-1.5 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(c.id)}
                        aria-label={tr('Delete conversation', 'Xóa cuộc trò chuyện')}
                        className="mr-2 ml-1 shrink-0 rounded-full p-2 text-slate-400 opacity-100 transition hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

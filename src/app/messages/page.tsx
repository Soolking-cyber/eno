'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { MessageSquare, ChevronRight } from 'lucide-react'

type Convo = {
  id: string
  listingTitle: string
  listingImage: string | null
  lastMessageAt: string
  lastMessageText: string | null
  unread: number
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
}

export default function MessagesPage() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const [convos, setConvos] = useState<Convo[] | null>(null)

  useEffect(() => {
    if (!user) return
    fetch('/api/conversations').then((r) => r.json()).then((d) => setConvos(d.conversations ?? [])).catch(() => setConvos([]))
  }, [user])

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
          <div className="space-y-2">
            {convos.map((c) => (
              <Link key={c.id} href={`/messages/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: c.counterpart.avatarColor }}>
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
                <ChevronRight className="h-4 w-4 shrink-0 text-[#cbd5e1]" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

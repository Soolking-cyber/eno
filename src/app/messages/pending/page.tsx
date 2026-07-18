'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useLanguage } from '@/context/language-context'
import { trackContactSeller, currencyCode } from '@/lib/analytics'
import { COMPOSE_KEY } from '@/components/marketplace/contact-composer'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

type Compose = { listingId: string; body: string; offerAmount?: number | null; listingTitle: string; listingImage: string | null; trackPrice: number | null; currency: string }

// Instant-redirect resolver: the composer pushes here immediately, then this page
// creates the conversation + sends the first message in the background and
// replaces itself with the real thread (cache-seeded → instant). A thread skeleton
// shows while it resolves, so the user feels a redirect, not a button spinner.
export default function PendingComposePage() {
  const router = useRouter()
  const { user } = useAuth()
  const { cacheThread } = useChat()
  const { tr } = useLanguage()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    let data: Compose | null = null
    try { data = JSON.parse(sessionStorage.getItem(COMPOSE_KEY) || 'null') } catch { /* ignore */ }
    // Valid if there's a note OR a structured offer.
    if (!data || !data.listingId || (!data.body && !data.offerAmount)) { router.replace('/messages'); return }
    const d = data
    try { sessionStorage.removeItem(COMPOSE_KEY) } catch { /* ignore */ }

    fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: d.listingId, message: d.body, offerAmount: d.offerAmount ?? undefined }),
    })
      .then(async (res) => {
        if (res.status === 401) { router.replace(`/listings/${d.listingId}`); return }
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}))
          toast.error(
            error === 'own_listing' ? tr("That's your own listing.", 'Đây là tin của chính bạn.')
            // Enforcement gates (trust Phase 2) — specific, calm copy over a generic failure.
            : error === 'account_suspended' ? tr('Your account is suspended — messaging is paused while we review it. Details are in your dashboard.', 'Tài khoản của bạn đang tạm ngưng — nhắn tin tạm dừng trong khi chúng tôi xem xét. Xem chi tiết trong trang quản lý.')
            : error === 'probation_conversation_cap' ? tr('New accounts can start up to 15 chats a day — please try again tomorrow.', 'Tài khoản mới có thể bắt đầu tối đa 15 cuộc trò chuyện mỗi ngày — hãy thử lại vào ngày mai.')
            : tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
          // Re-stash the draft before bouncing (audit P2): removeItem ran up front,
          // so without this a transient failure silently DISCARDED the typed message
          // or structured offer the user composed.
          try { sessionStorage.setItem(COMPOSE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
          router.replace(`/listings/${d.listingId}`)
          return
        }
        const { id, created, message } = await res.json()
        cacheThread(id, {
          id,
          me: user?.id ?? '',
          listing: { id: d.listingId, title: d.listingTitle, image: d.listingImage },
          counterpart: { name: '', avatarColor: 'var(--brand)', avatarUrl: null },
          messages: message ? [{ id: message.id, mine: true, body: message.body, createdAt: message.createdAt, kind: message.kind, offerAmount: message.offerAmount, offerStatus: message.offerStatus }] : [],
        })
        if (created) trackContactSeller({ id: d.listingId, title: d.listingTitle, price: d.trackPrice ?? undefined, currency: currencyCode(d.currency) })
        router.replace(`/messages/${id}`)
      })
      .catch(() => {
        try { sessionStorage.setItem(COMPOSE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
        toast.error(tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
        router.replace(`/listings/${d.listingId}`)
      })
  }, [router, cacheThread, user, tr])

  // Thread skeleton while the conversation resolves.
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex-1 space-y-2 px-4 py-4">
        {[['end', 'w-44'], ['start', 'w-32']].map(([side, w], i) => (
          <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
            <Skeleton className={`h-9 ${w} rounded-2xl`} />
          </div>
        ))}
      </div>
    </div>
  )
}

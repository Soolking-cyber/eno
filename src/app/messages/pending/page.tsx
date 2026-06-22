'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useLanguage } from '@/context/language-context'
import { trackContactSeller, currencyCode } from '@/lib/analytics'
import { COMPOSE_KEY } from '@/components/marketplace/contact-composer'
import { toast } from 'sonner'

type Compose = { listingId: string; body: string; listingTitle: string; listingImage: string | null; trackPrice: number | null; currency: string }

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
    if (!data || !data.listingId || !data.body) { router.replace('/messages'); return }
    const d = data
    try { sessionStorage.removeItem(COMPOSE_KEY) } catch { /* ignore */ }

    fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: d.listingId, message: d.body }),
    })
      .then(async (res) => {
        if (res.status === 401) { router.replace(`/listings/${d.listingId}`); return }
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}))
          toast.error(error === 'own_listing' ? tr("That's your own listing.", 'Đây là tin của chính bạn.') : tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
          router.replace(`/listings/${d.listingId}`)
          return
        }
        const { id, created, message } = await res.json()
        cacheThread(id, {
          id,
          me: user?.id ?? '',
          listing: { id: d.listingId, title: d.listingTitle, image: d.listingImage },
          counterpart: { name: '', avatarColor: '#0a66c2', avatarUrl: null },
          messages: message ? [{ id: message.id, mine: true, body: message.body, createdAt: message.createdAt }] : [],
        })
        if (created) trackContactSeller({ id: d.listingId, title: d.listingTitle, price: d.trackPrice ?? undefined, currency: currencyCode(d.currency) })
        router.replace(`/messages/${id}`)
      })
      .catch(() => { toast.error(tr('Could not send. Try again.', 'Không gửi được. Thử lại.')); router.replace(`/listings/${d.listingId}`) })
  }, [router, cacheThread, user, tr])

  // Thread skeleton while the conversation resolves.
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="h-9 w-9 shrink-0 rounded-full shimmer" />
        <div className="h-4 w-32 rounded shimmer" />
      </div>
      <div className="flex-1 space-y-2 px-4 py-4">
        {[['end', 'w-44'], ['start', 'w-32']].map(([side, w], i) => (
          <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
            <div className={`h-9 ${w} rounded-2xl shimmer`} />
          </div>
        ))}
      </div>
    </div>
  )
}

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
import { OBJECTIONABLE_CONTENT, objectionableCopy } from '@/lib/ugc-copy'
import { refusalToast } from '@/lib/refusal-toast'
import { teacherAwaitingReplyMessage, teacherDmLimitMessage, teacherDmStep } from '@/lib/teachers/dm-limit-copy'
import { iosVerifyElsewhereText } from '@/components/marketplace/ios-browser-only-note'
import { iosHideKycClient } from '@/lib/ios-hide-kyc'

type Compose = { listingId: string; body: string; offerAmount?: number | null; listingTitle: string; listingImage: string | null; trackPrice: number | null; currency: string; plan?: boolean }

// Instant-redirect resolver: the composer pushes here immediately, then this page
// creates the conversation + sends the first message in the background and
// replaces itself with the real thread (cache-seeded → instant). A thread skeleton
// shows while it resolves, so the user feels a redirect, not a button spinner.
export default function PendingComposePage() {
  const router = useRouter()
  const { user, accountType, identityLoaded } = useAuth()
  const { cacheThread } = useChat()
  const { tr } = useLanguage()
  const ran = useRef(false)
  // ⚠️ The effect below runs ONCE (`ran`), and its answer can land before /api/me does — on a full document load (every
  // deploy turns router.push into one) the first render is hydration. So the account is read through a ref when the answer
  // arrives and again when a step is tapped, never from the first render's closure (pre-review, 2026-10-13).
  const account = useRef({ accountType, identityLoaded })
  useEffect(() => { account.current = { accountType, identityLoaded } })

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    let data: Compose | null = null
    try { data = JSON.parse(sessionStorage.getItem(COMPOSE_KEY) || 'null') } catch { /* ignore */ }
    // Valid if there's a note OR a structured offer OR it is the trip planner's "just open the
    // thread" handoff, which deliberately carries neither.
    if (!data || !data.listingId || (!data.body && !data.offerAmount && !data.plan)) { router.replace('/messages'); return }
    const d = data
    try { sessionStorage.removeItem(COMPOSE_KEY) } catch { /* ignore */ }

    fetch('/api/conversations', {
      // ⚠️ THE PLAN HANDOFF POSTS NOTHING. `message: ''` would still be a message on some paths, so
      // the field is omitted entirely rather than emptied — the whole point is that opening the
      // planner stops adding a line of chat every time it is tapped.
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(
        d.plan
          ? { listingId: d.listingId }
          : { listingId: d.listingId, message: d.body, offerAmount: d.offerAmount ?? undefined },
      ),
    })
      .then(async (res) => {
        if (res.status === 401) { router.replace(`/listings/${d.listingId}`); return }
        if (!res.ok) {
          const refusal = await res.json().catch(() => ({}))
          const { error } = refusal
          // ⛔ THE TEACHER DM LADDER (owner, 2026-10-13 — src/lib/teachers/dm-quota.ts): a new teacher over today's limit
          // is told why and offered the one step that lifts it — verify identity, switch to or verify a business — or to
          // come back after midnight. In the iOS app with `ios-hide-kyc` on, a verification step is a sentence naming the
          // website, never a button. A body without `tier` (an older server mid-deploy) falls through to the plain line.
          const ladder = error === 'teacher_thread_cap' ? teacherDmLimitMessage(refusal, tr) : null
          // The gate is read LIVE: the hook's first render is hydration, where it answers false (use-ios-hide-kyc.ts).
          const hideKyc = iosHideKycClient()
          // The label from the account as it stands now — an account not loaded yet is taken as onboarded, the common
          // case; the step's TARGET is decided again on the tap, when it has loaded ('switch_to_business' differs by type).
          const now = account.current
          const step = ladder ? teacherDmStep(refusal.next, now.identityLoaded ? now.accountType : 'individual', tr) : null
          const showStep = step && !(step.kyc && hideKyc)
          if (ladder || error === 'teacher_awaiting_reply') {
            refusalToast(
              ladder ? (step?.kyc && hideKyc ? `${ladder} ${iosVerifyElsewhereText(step.kyc, tr)}` : ladder) : teacherAwaitingReplyMessage(tr),
              // The target from the account as it stands at the tap — with the label's own fallback while it has not loaded,
              // so the two never disagree (gate review, 2026-10-13).
              { id: 'teacher-dm-limit', step: showStep ? { label: step.label, onClick: () => {
                const at = account.current
                router.push(teacherDmStep(refusal.next, at.identityLoaded ? at.accountType : 'individual', tr)?.href ?? step.href)
              } } : null },
            )
          } else toast.error(
            error === 'own_listing' ? tr("That's your own listing.", 'Đây là tin của chính bạn.')
            // App Store gate `ios-hide-visa` (D5 = b) — only ever answered to the iOS app while the gate is on. NEUTRAL on
            // purpose: this page is shared with eno.vn, so no e-Visa word may sit in it; the listing page it bounces to
            // below carries the full sentence (VisaInAppNote).
            : error === 'ios_app_unavailable' ? tr('This can’t be done in the app — the listing page says where.', 'Không thể thực hiện việc này trong ứng dụng — trang tin đăng có hướng dẫn nơi thực hiện.')
            // Enforcement gates (trust Phase 2) — specific, calm copy over a generic failure.
            : error === 'account_suspended' ? tr('Your account is suspended — messaging is paused while we review it. Details are in your dashboard.', 'Tài khoản của bạn đang tạm ngưng — nhắn tin tạm dừng trong khi chúng tôi xem xét. Xem chi tiết trong trang quản lý.')
            : error === 'teacher_thread_cap' ? tr('You have reached today’s limit for new chats. Please try again tomorrow.', 'Bạn đã đạt giới hạn cuộc trò chuyện mới hôm nay. Vui lòng thử lại vào ngày mai.')
            : error === 'probation_conversation_cap' ? tr('New accounts can start up to 15 chats a day — please try again tomorrow.', 'Tài khoản mới có thể bắt đầu tối đa 15 cuộc trò chuyện mỗi ngày — hãy thử lại vào ngày mai.')
            // App Store gate `ugc-safety` (R3) — only ever answered while the gate is on.
            : error === 'blocked' ? tr('You can’t message this seller.', 'Bạn không thể nhắn tin cho người bán này.')
            // App Store gate `ugc-safety` (R5): the word filter refused the first message. The draft is
            // re-stashed below, so the listing page gives it back to be rephrased.
            : error === OBJECTIONABLE_CONTENT ? objectionableCopy('message', tr)
            : tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
          // Re-stash the draft before bouncing (audit P2): removeItem ran up front,
          // so without this a transient failure silently DISCARDED the typed message
          // or structured offer the user composed.
          try { sessionStorage.setItem(COMPOSE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
          router.replace(`/listings/${d.listingId}`)
          return
        }
        const { id, created, message, held } = await res.json()
        // A teacher who has not answered the writer's two messages (DM ladder, owner 2026-10-13): the thread opens and the
        // opener was not sent — say why, once, as the chat appears.
        if (held === 'teacher_awaiting_reply') refusalToast(teacherAwaitingReplyMessage(tr), { id: 'teacher-dm-limit', step: null })
        cacheThread(id, {
          id,
          me: user?.id ?? '',
          listing: { id: d.listingId, title: d.listingTitle, image: d.listingImage },
          counterpart: { name: '', avatarColor: 'var(--brand)', avatarUrl: null },
          messages: message ? [{ id: message.id, mine: true, body: message.body, createdAt: message.createdAt, kind: message.kind, offerAmount: message.offerAmount, offerStatus: message.offerStatus }] : [],
        })
        if (created) trackContactSeller({ id: d.listingId, title: d.listingTitle, price: d.trackPrice ?? undefined, currency: currencyCode(d.currency) })
        // `?plan=1` tells the thread to open the itinerary wizard on arrival. The thread strips it
        // from the URL as soon as it has read it, so it never survives a share or a reload.
        router.replace(d.plan ? `/messages/${id}?plan=1` : `/messages/${id}`)
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

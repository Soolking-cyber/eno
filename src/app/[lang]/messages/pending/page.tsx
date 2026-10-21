'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useLanguage } from '@/context/language-context'
import { trackContactSeller, currencyCode } from '@/lib/analytics'
import { COMPOSE_KEY } from '@/components/marketplace/contact-composer'
import { teacherThreadChips } from '@/components/marketplace/quick-reply-chips'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ChevronLeft, Send } from '@/components/ui/icons'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { OBJECTIONABLE_CONTENT, objectionableCopy } from '@/lib/ugc-copy'
import { refusalToast } from '@/lib/refusal-toast'
import { teacherOpener } from '@/lib/teachers/first-message'
import { teacherAwaitingReplyMessage, teacherDmLimitMessage, teacherDmStep } from '@/lib/teachers/dm-limit-copy'
import { iosVerifyElsewhereText } from '@/components/marketplace/ios-browser-only-note'
import { iosHideKycClient } from '@/lib/ios-hide-kyc'

/** `pick`: let the writer choose the first message (src/lib/quick-contact.ts stashCompose) — nothing to send yet. */
type Pick = { voice: 'school' | 'person'; cover: boolean }
type Compose = { listingId: string; body: string; offerAmount?: number | null; listingTitle: string; listingImage: string | null; trackPrice: number | null; currency: string; plan?: boolean; pick?: Pick }

// Instant-redirect resolver: the composer pushes here immediately, then this page
// creates the conversation + sends the first message in the background and
// replaces itself with the real thread (cache-seeded → instant). A thread skeleton
// shows while it resolves, so the user feels a redirect, not a button spinner.
// ⛔ EXCEPT A TEACHER'S "Message" BUTTON (owner, 2026-10-21: "dont send the message directly make sure it opens message
// and they can select from available quick send chips"): its stash carries `pick` and no body, so this page shows the
// teacher and the writer's opener chips, and sends — the same request as every other door — only the message the writer
// taps or types. A new teacher thread opens only WITH its first message (api/conversations), so none is opened before.
export default function PendingComposePage() {
  const router = useRouter()
  const { user, accountType, identityLoaded } = useAuth()
  const { cacheThread } = useChat()
  const { tr } = useLanguage()
  const ran = useRef(false)
  // ⚠️ The effect below runs ONCE (`ran`), and its answer can land before /api/me does — on a full document load (every
  // deploy turns router.push into one) the first render is hydration. So the account is read through a ref when the answer
  // arrives, never from the first render's closure (pre-review, 2026-10-13).
  const account = useRef({ accountType, identityLoaded })
  useEffect(() => { account.current = { accountType, identityLoaded } })
  // The teacher chooser (`pick`), until the writer chooses; then the skeleton while the thread resolves.
  const [picking, setPicking] = useState<Compose | null>(null)
  const [sending, setSending] = useState(false)

  // `stay`: a teacher's chosen first message — on a refusal or a dropped connection the writer stays on the chooser with
  // their words in the box, never bounced away without them (codex + opus, gate 13a: the bounce re-stashed the text
  // where the teacher's page never reads it back).
  const submit = useCallback((d: Compose, stay?: () => void) => {
    // Set once the server has the message: from then on nothing offers to send it again — an answer that fails to read
    // after a 200 lands in the inbox, where the thread is (opus, gate 13b).
    let accepted = false
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
          // The step — label AND target — from the account as known when the answer arrived: this page unmounts right
          // after the toast, so nothing newer can reach the tap. An account not loaded by then is taken as onboarded, the
          // common case (sign-in sends an account with no type to /onboard first); 'switch_to_business' differs by type.
          const now = account.current
          const step = ladder ? teacherDmStep(refusal.next, now.identityLoaded ? now.accountType : 'individual', tr) : null
          const showStep = step && !(step.kyc && hideKyc)
          if (ladder || error === 'teacher_awaiting_reply') {
            refusalToast(
              ladder ? (step?.kyc && hideKyc ? `${ladder} ${iosVerifyElsewhereText(step.kyc, tr)}` : ladder) : teacherAwaitingReplyMessage(tr),
              { id: 'teacher-dm-limit', step: showStep ? { label: step.label, onClick: () => router.push(step.href) } : null },
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
          if (stay) { stay(); return }
          // Re-stash the draft before bouncing (audit P2): removeItem ran up front,
          // so without this a transient failure silently DISCARDED the typed message
          // or structured offer the user composed.
          try { sessionStorage.setItem(COMPOSE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
          router.replace(`/listings/${d.listingId}`)
          return
        }
        accepted = true
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
        if (accepted) { router.replace('/messages'); return }
        toast.error(tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
        if (stay) { stay(); return }
        try { sessionStorage.setItem(COMPOSE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
        router.replace(`/listings/${d.listingId}`)
      })
  }, [router, cacheThread, user, tr])

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    let data: Compose | null = null
    try { data = JSON.parse(sessionStorage.getItem(COMPOSE_KEY) || 'null') } catch { /* ignore */ }
    // Valid if there's a note OR a structured offer OR it is the trip planner's "just open the
    // thread" handoff, which deliberately carries neither, OR a teacher's "let me choose".
    if (!data || !data.listingId || (!data.body && !data.offerAmount && !data.plan && !data.pick)) { router.replace('/messages'); return }
    const d = data
    // Read ONCE, on arrival, by every door: a stash that outlived its screen brought a stale chooser back on Forward, a
    // reload, a header link's way out or a duplicated tab (codex + opus, gates 13a–13b). A reload lands in the inbox.
    try { sessionStorage.removeItem(COMPOSE_KEY) } catch { /* ignore */ }
    // ⛔ NOTHING IS SENT FOR A PICK until the writer chooses.
    if (d.pick) { setPicking(d); return }
    submit(d)
  }, [router, submit])

  const choose = (text: string) => {
    const body = text.trim()
    if (!picking || sending || !body) return
    setSending(true)
    submit({ ...picking, body, pick: undefined }, () => setSending(false))
  }
  // Back: to the teacher's page, nothing sent — a fixed place, as the thread's own Back goes to /messages, never the
  // browser's history: a restored or duplicated tab's previous page may not be eno's (codex + opus, gates 13a–13b).
  const back = (d: Compose) => router.replace(`/listings/${d.listingId}`)

  // The chooser stays up while its message is sent, so a refusal finds the writer's words still in the box.
  if (picking) return <TeacherOpenerPicker d={picking} sending={sending} onChoose={choose} onBack={() => back(picking)} />

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

/**
 * The first message to a teacher, chosen — never sent for the writer. The chips are the thread's own openers for a writer
 * who has not written yet (quick-reply-chips.tsx teacherThreadChips, in the writer's voice), with the cover-lesson opener
 * first when a school asked for one; a chip that is a whole message sends on tap, as in the thread, and one to complete
 * goes into the box. Or the writer types their own.
 */
function TeacherOpenerPicker({ d, sending, onChoose, onBack }: { d: Compose; sending: boolean; onChoose: (text: string) => void; onBack: () => void }) {
  const { tr } = useLanguage()
  const [draft, setDraft] = useState('')
  const voice = d.pick?.voice === 'school' ? 'school' : 'person'
  const chips = [
    ...(d.pick?.cover && voice === 'school' ? [{ label: tr('Ask about a cover lesson', 'Hỏi về buổi dạy thay'), text: teacherOpener(tr, 'cover', 'school'), complete: true }] : []),
    ...teacherThreadChips({ isSeller: false, buyerHasSent: false, sellerRepliedAfterBuyer: false, teacherShared: false, voice }, tr),
  ]
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        {/* Back to the teacher's page — nothing was sent, so nothing is left behind */}
        <IconButton aria-label={tr('Back', 'Quay lại')} onClick={onBack} disabled={sending}><ChevronLeft /></IconButton>
        <Avatar name={d.listingTitle} url={d.listingImage} size="sm" />
        <p className="min-w-0 truncate text-base font-semibold text-foreground">{d.listingTitle}</p>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 px-4 py-4" aria-busy={sending}>
        <p className="text-sm text-body" role="status">
          {sending ? tr('Sending…', 'Đang gửi…') : tr('Choose your first message — it is sent only when you tap it — or write your own.', 'Chọn tin nhắn đầu tiên — tin chỉ được gửi khi bạn chạm vào — hoặc tự viết tin của bạn.')}
        </p>
        <div className="flex flex-wrap gap-2" data-testid="teacher-opener-chips">
          {chips.map((c) => (
            <Chip key={c.text} size="md" tone="neutral" disabled={sending} onClick={() => (c.complete ? onChoose(c.text) : setDraft(c.text))}>
              {c.label}
            </Chip>
          ))}
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); onChoose(draft) }}>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            readOnly={sending}
            placeholder={tr('Write a message…', 'Viết tin nhắn…')}
            aria-label={tr('Your message', 'Tin nhắn của bạn')}
          />
          <Button type="submit" variant="cta" size="icon" disabled={sending || !draft.trim()} aria-label={tr('Send', 'Gửi')}>
            <Send />
          </Button>
        </form>
      </div>
    </div>
  )
}

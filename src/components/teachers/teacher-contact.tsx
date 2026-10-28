'use client'

// "Message teacher" (owner, 2026-09-30; the DM ladder, 2026-10-13): any signed-in account may start the chat, within its
// daily limit of NEW teachers (src/lib/teachers/dm-quota.ts — 3 unverified, 10 identity-verified, 30 as a verified
// business). The block asks where the account stands BEFORE it opens the chat, so a refusal is said here, with the
// step that lifts it; the server refuses the same count either way. The teacher's phone, email and CV are never here —
// they arrive in the thread only after the teacher taps "Share" — EXCEPT the Zalo a cover teacher chose to show for urgent
// cover (owner, 2026-10-28), revealed to a school by CoverZaloReveal below (src/lib/teachers/zalo.ts).
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IosVerifyElsewhereNote } from '@/components/marketplace/ios-browser-only-note'
import { useIosHideKyc } from '@/hooks/use-ios-hide-kyc'
import { stashCompose } from '@/lib/quick-contact'
import { openerVoice } from '@/lib/teachers/first-message'
import { teacherDmLimitMessage, teacherDmStep, type TeacherDmRefusalFacts } from '@/lib/teachers/dm-limit-copy'
import { scrollBehavior } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'
import { CoverZaloReveal } from './cover-zalo-reveal'

/** The contact block's anchor, and the event the first-screen button fires at it (TeacherContactJump). */
export const TEACHER_CONTACT_ID = 'teacher-contact'
export const TEACHER_CONTACT_EVENT = 'eno:teacher-contact'

/** GET /api/teachers/dm-quota — where the account stands today on the teacher DM ladder, and its thread with this teacher. */
type Quota = TeacherDmRefusalFacts & { remaining: number; hasThread: boolean; threadId?: string | null }

export function TeacherContact({ listingId, name, image, cover = false }: {
  listingId: string
  name: string
  image: string | null
  /** The teacher offers cover lessons (2026-10-07): a second opener asks about a cover instead of a job. */
  cover?: boolean
}) {
  const { user, loading, accountType, identityLoaded, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const hideKyc = useIosHideKyc()
  const [busy, setBusy] = useState(false)
  // Today's standing (null until it answers — the tap then goes through and the server decides), and the refusal shown.
  // ⚠️ Each is kept WITH the account it was asked for, and read only for that account: a sign-out (or another account
  // signing in on this page) must never keep showing the last account's limit (gate review, 2026-10-13).
  const [quotaFor, setQuotaFor] = useState<{ uid: string; q: Quota } | null>(null)
  const [refusedFor, setRefusedFor] = useState<{ uid: string; q: Quota } | null>(null)
  const quota = user && quotaFor?.uid === user.id ? quotaFor.q : null
  const refused = user && refusedFor?.uid === user.id ? refusedFor.q : null
  const setQuota = (q: Quota) => { if (user) setQuotaFor({ uid: user.id, q }) }
  const setRefused = (q: Quota | null) => setRefusedFor(q && user ? { uid: user.id, q } : null)
  // Which opener the tap asked for. A ref, so the queued replay (below) sends the one the school tapped.
  const intent = useRef<'hire' | 'cover'>('hire')

  // Ask once the account is known. The page is ISR, so this is client state; a failed ask changes nothing. Bounded at 8 s
  // like every other wait here: on a dead connection the tap's re-ask must not hold the buttons on "Opening chat…".
  const askQuota = () => fetch(`/api/teachers/dm-quota?listingId=${encodeURIComponent(listingId)}`, {
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  })
    .then((r) => (r.ok ? r.json() as Promise<Quota> : null))
    .catch(() => null)
  useEffect(() => {
    if (!user || !identityLoaded) return
    let off = false
    const uid = user.id
    void askQuota().then((q) => { if (!off && q) setQuotaFor({ uid, q }) })
    return () => { off = true }
  }, [user, identityLoaded, listingId])

  // ⛔ A cover lesson is asked by a business only (the guides: cover work is lawful only for the employer holding the
  // work permit). Offered to a visitor not yet signed in — they may be a school — and hidden once a personal account shows.
  const offerCover = cover && !(user && identityLoaded && accountType !== 'business')

  // A tap before the account type has loaded is QUEUED, not dropped (Opus, commit gate 09-30).
  const queued = useRef(false)
  useEffect(() => {
    if (queued.current && identityLoaded) { queued.current = false; start(true) }
  })
  // `force`: the queued replay — `busy` in this closure is the queue's own spinner, not a second tap.
  const start = (force = false, want?: 'hire' | 'cover') => {
    if (busy && !force) return
    // The opener is fixed HERE, past the busy check: a second tap while a first one waits for the account to load
    // must not swap the queued cover request for the hiring opener (gate review, 2026-10-07).
    if (want) intent.current = want
    // Every early return below also drops the queue's spinner — a stuck "Opening chat…" is worse
    // than none (agy + Opus, commit gate 09-30).
    if (force) setBusy(false)
    if (loading) return
    if (!user) {
      // "Sign in to message Jane Doe about a cover lesson" — the teacher by name, never "the seller", and what the
      // visitor came for (preview check, 2026-10-07: the card's fallback called a teacher "the seller").
      openSignIn({
        sellerName: name,
        listingTitle: intent.current === 'cover' ? tr('a cover lesson', 'việc dạy thay') : tr('a teaching job', 'công việc giảng dạy'),
        listingImage: image,
        note: tr('Sign in to message teachers.', 'Đăng nhập để nhắn tin cho giáo viên.'),
      })
      return
    }
    // accountType arrives with the profile, after `user` — never judge it before it has loaded.
    if (!identityLoaded) {
      queued.current = true; setBusy(true)
      // Backstop: if the account never loads, release the button rather than spin forever.
      setTimeout(() => { if (queued.current) { queued.current = false; setBusy(false) } }, 8000)
      return
    }
    // Over today's limit for a NEW teacher: say it here, with the step that lifts it — nothing is stashed or sent. A
    // teacher this account already writes to is never counted, so the chat opens. ⛔ ASKED AGAIN ON THE TAP before it
    // refuses: the page may have sat open past the Vietnam midnight, or a verification may have been approved since —
    // a refusal from the first answer would block a chat the server now allows (tests agent, 2026-10-13).
    if (quota && !quota.hasThread && quota.remaining <= 0) {
      setBusy(true)
      void askQuota().then((q) => {
        setBusy(false)
        // A FAILED re-ask lets the server decide, as a failed first ask does — refusing on the stale answer would block a
        // chat the server may now allow, past midnight above all (pre-review, 2026-10-13).
        if (q) setQuota(q)
        if (q && !q.hasThread && q.remaining <= 0) { setRefused(q); return }
        setRefused(null)
        openChat(q ?? quota)
      })
      return
    }
    openChat()
  }
  const openChat = (q: Quota | null = quota) => {
    setBusy(true)
    // Backstop: never leave a permanently spinning button if the navigation stalls.
    setTimeout(() => setBusy(false), 8000)
    // A writer who already has a thread with this teacher goes back INTO it — its own replies and chips — never to the
    // first-contact chooser again (opus, gate 13c: "We are hiring" a second time, or words typed for a teacher who has not
    // answered the last two, which the server holds and drops).
    if (q?.threadId) { router.push(`/messages/${q.threadId}`); return }
    // ⛔ NOTHING IS SENT HERE (owner, 2026-10-21: "dont send the message directly … they can select from available quick
    // send chips"): /messages/pending shows the teacher and the opener chips, and the thread starts only with the message
    // the writer picks or types there. A school's cover button asks for the cover-lesson opener among them.
    stashCompose({
      listingId,
      pick: { voice: openerVoice(accountType), cover: intent.current === 'cover' && accountType === 'business' },
      listingTitle: name,
      listingImage: image,
      currency: '₫',
    })
    router.push('/messages/pending')
  }

  // The first-screen "Message" button (TeacherContactJump) runs THIS start — one action, one set of rules
  // (sign-in, the daily limit, the queue) — never a second copy of them. A ref, so the listener
  // reads the current render's closure without re-subscribing on every render.
  // Kept current in an effect, never written during render (React refs rule); the listener below reads it.
  const startRef = useRef(start)
  useEffect(() => { startRef.current = start })
  useEffect(() => {
    const onJump = (e: Event) => {
      if ((e as CustomEvent<{ listingId?: string }>).detail?.listingId !== listingId) return
      // A cover teacher has TWO openers here (a cover lesson, or a job): the jump only brings the visitor to them —
      // starting the hiring chat would send "we are hiring" to someone they came to ask about a cover (2026-10-07).
      if (offerCover) return
      startRef.current()
    }
    window.addEventListener(TEACHER_CONTACT_EVENT, onJump)
    return () => window.removeEventListener(TEACHER_CONTACT_EVENT, onJump)
  }, [listingId, offerCover])

  const refusal = refused ? teacherDmLimitMessage(refused, tr) : null
  const step = refused ? teacherDmStep(refused.next, accountType, tr) : null

  return (
    // `scroll-mt-24`: the jump lands it clear of the sticky header (lg:top-24 is the aside's own offset).
    <div id={TEACHER_CONTACT_ID} className="scroll-mt-24 space-y-2">
      {offerCover && (
        <Button variant="cta" className="w-full" onClick={() => start(false, 'cover')} disabled={busy}>
          {busy && intent.current === 'cover' ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Ask about a cover lesson', 'Hỏi về buổi dạy thay')}
        </Button>
      )}
      <Button variant={offerCover ? 'secondary' : 'cta'} className="w-full" onClick={() => start(false, 'hire')} disabled={busy}>
        {busy && intent.current === 'hire' ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Message teacher', 'Nhắn tin cho giáo viên')}
      </Button>
      {/* A school only, and only while the teacher offers it to this account right now (it asks; nothing is drawn else). */}
      {cover && <CoverZaloReveal listingId={listingId} />}
      {refusal && (
        <div role="status" className="space-y-2 text-sm text-body">
          <p>{refusal}</p>
          {/* In the iOS app with `ios-hide-kyc` on, a verification step is plain text naming the website, never a link. */}
          {step && (step.kyc && hideKyc
            ? <IosVerifyElsewhereNote kind={step.kyc} />
            : <Link href={step.href} className="font-semibold text-brand underline">{step.label}</Link>)}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {cover
          ? tr('The teacher’s phone, email and CV are shared with you only if they choose to: in your chat — or, for urgent cover, a Zalo number if they chose to show one to schools.', 'Số điện thoại, email và CV của giáo viên chỉ được chia sẻ với bạn nếu giáo viên đồng ý: trong cuộc trò chuyện — hoặc, với dạy thay khẩn, số Zalo nếu giáo viên đã chọn hiển thị cho các trường.')
          : tr('The teacher’s phone, email and CV are shared with you only if they choose to share them in your chat.', 'Số điện thoại, email và CV của giáo viên chỉ được chia sẻ với bạn trong cuộc trò chuyện nếu giáo viên đồng ý.')}
      </p>
    </div>
  )
}

/**
 * "Message" BESIDE THE NAME, IN THE FIRST SCREEN (rentals-12). On a phone the profile stacks and the
 * contact block falls below the bio, the teaching rows, the experience and the qualifications — a school
 * had to scroll the whole profile to find the one button. This one SCROLLS TO that block and fires ITS
 * action (TEACHER_CONTACT_EVENT), so the outcome lands where the reader now is: the sign-in sheet for a
 * guest, the daily-limit note with its next step for an account over it (the DM ladder, owner 2026-10-13), the chat
 * for everyone else.
 * ⚠️ NO STICKY BAR (owner, §6) — an in-flow button only. Below lg only: on desktop the contact block is the
 * sticky right-hand column, already beside the name.
 */
export function TeacherContactJump({ listingId, className }: { listingId: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <Button
      variant="cta"
      className={cn('relative tap-44', className)}
      onClick={() => {
        document.getElementById(TEACHER_CONTACT_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
        window.dispatchEvent(new CustomEvent(TEACHER_CONTACT_EVENT, { detail: { listingId } }))
      }}
    >
      {tr('Message', 'Nhắn tin')}
    </Button>
  )
}

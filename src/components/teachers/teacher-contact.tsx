'use client'

// "Message teacher" (owner, 2026-09-30; the DM ladder, 2026-10-13): any signed-in account may start the chat, within its
// daily limit of NEW teachers (src/lib/teachers/dm-quota.ts — 3 unverified, 10 identity-verified, 30 as a verified
// business). The block asks where the account stands BEFORE it opens the chat, so a refusal is said here, with the
// step that lifts it; the server refuses the same count either way. The teacher's phone, email and CV are never here —
// they arrive in the thread only after the teacher taps "Share" — EXCEPT the Zalo a cover teacher chose to show for urgent
// cover (owner, 2026-10-28), revealed to a school by CoverZaloReveal below (src/lib/teachers/zalo.ts).
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { ChevronRight } from '@/components/ui/icons'
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

/** Bounded at 8 s: AbortSignal.timeout where the browser has it; elsewhere (an older in-app browser) an AbortController on
 *  the same timer, let go once the request and its body have settled (2026-11-06 audit; cover-zalo-reveal.tsx and the teacher
 *  panels carry the same helper). */
const WAIT_MS = 8000
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (typeof AbortSignal.timeout === 'function') return run(AbortSignal.timeout(WAIT_MS))
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), WAIT_MS)
  try { return await run(ctl.signal) } finally { clearTimeout(timer) }
}

/**
 * Whether the cover-lesson opener is offered to THIS reader right now — one formula for the block below and for its remote
 * under the week (TeacherCoverAsk), so the two can never disagree.
 * ⛔ A cover lesson is asked by a business only (the guides: cover work is lawful only for the employer holding the work
 * permit). Offered to a visitor not yet signed in — they may be a school — and hidden once a personal account shows.
 */
export function useOfferCover(cover: boolean): boolean {
  const { user, accountType, identityLoaded } = useAuth()
  return cover && !(user && identityLoaded && accountType !== 'business')
}

/**
 * THE BLOCK'S BUSY STATE, FOR ITS REMOTE (owner-approved 2026-11-14, cook r04 teachers): below lg the cover ask is a link
 * under the week (TeacherCoverAsk), far from this block, and it must say "Opening chat…" and hold still while the block
 * works, exactly as the desktop button does. A module store keyed by listing: every snapshot is a stored object (or IDLE),
 * so `useSyncExternalStore` sees a stable value until the block publishes a change, and the server snapshot is IDLE — the
 * HTML and the first client render agree. The block deletes its entry when it unmounts.
 */
type Busy = { busy: boolean; intent: 'hire' | 'cover' }
const IDLE: Busy = { busy: false, intent: 'hire' }
const busyByListing = new Map<string, Busy>()
const busyListeners = new Set<() => void>()
function publishBusy(listingId: string, next: Busy | null) {
  const prev = busyByListing.get(listingId)
  if (next ? prev?.busy === next.busy && prev?.intent === next.intent : !prev) return
  if (next) busyByListing.set(listingId, next)
  else busyByListing.delete(listingId)
  for (const l of busyListeners) l()
}
function subscribeBusy(l: () => void) {
  busyListeners.add(l)
  return () => { busyListeners.delete(l) }
}
/** The contact block's busy state for this listing (IDLE on the server, and while no block is mounted). */
export function useContactBusy(listingId: string): Busy {
  return useSyncExternalStore(subscribeBusy, () => busyByListing.get(listingId) ?? IDLE, () => IDLE)
}

export function TeacherContact({ listingId, name, image, cover = false, counsel }: {
  listingId: string
  name: string
  image: string | null
  /** The teacher offers cover lessons (2026-10-07): a second opener asks about a cover instead of a job. */
  cover?: boolean
  /**
   * The page's counsel sentence (what eno checked — the profile's identity line), a server node. Below lg it opens the
   * counsel panel at the end of the profile; from lg the page shows it under the header instead (teacher-profile-view.tsx).
   */
  counsel?: ReactNode
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
  // ⚠️ bounded(), not `AbortSignal.timeout ?? undefined`: where the browser lacks it the wait had no bound at all.
  const askQuota = () => bounded(async (signal) => {
    const r = await fetch(`/api/teachers/dm-quota?listingId=${encodeURIComponent(listingId)}`, { cache: 'no-store', signal })
    return r.ok ? ((await r.json()) as Quota) : null
  }).catch(() => null)
  useEffect(() => {
    if (!user || !identityLoaded) return
    let off = false
    const uid = user.id
    void askQuota().then((q) => { if (!off && q) setQuotaFor({ uid, q }) })
    return () => { off = true }
  }, [user, identityLoaded, listingId])

  // ⛔ A cover lesson is asked by a business only — useOfferCover, above, says who.
  const offerCover = useOfferCover(cover)
  // The remote under the week reads this (useContactBusy): published after each change, and taken back on unmount.
  useEffect(() => { publishBusy(listingId, { busy, intent: intent.current }) }, [busy, listingId])
  useEffect(() => () => publishBusy(listingId, null), [listingId])

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
  // ⛔ IT OPENS THE CHOOSER ON A COVER TEACHER TOO (best-practice gap 2026-11-10). It used to only scroll there, because
  // "starting the hiring chat would send 'we are hiring' to someone they came to ask about a cover" (2026-10-07) — but since
  // the owner's 2026-10-21 rule nothing is sent from here: /messages/pending shows the openers and the writer picks. So a
  // school gets the chooser WITH the cover-lesson opener among its chips (`pick.cover`, business only, as below); anyone
  // else the job ones — a guest's sign-in sheet never says "a cover lesson": they may be a parent. The scroll stays, so a
  // refusal still shows where the reader lands. ⚠️ ASKED FOR WHILE THE ACCOUNT MAY STILL BE A SCHOOL (review): signed in with
  // the type still loading, the tap is queued and replayed — and openChat sets `pick.cover` only for a business, so a
  // personal account that turns out not to be one gets the job openers anyway.
  // `want`: what the remote asked for — the cover ask under the week sends 'cover' (TeacherCoverAsk); the first-screen button
  // sends nothing and keeps the rule above. A cover want this reader is not offered falls back to the job openers.
  const startRef = useRef<(want?: 'hire' | 'cover') => void>(() => {})
  useEffect(() => {
    startRef.current = (want) => start(false, want === 'cover' ? (offerCover ? 'cover' : 'hire') : want ?? (offerCover && user ? 'cover' : 'hire'))
  })
  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<{ listingId?: string; want?: 'hire' | 'cover' }>).detail
      if (detail?.listingId !== listingId) return
      startRef.current(detail.want === 'cover' || detail.want === 'hire' ? detail.want : undefined)
    }
    window.addEventListener(TEACHER_CONTACT_EVENT, onJump)
    return () => window.removeEventListener(TEACHER_CONTACT_EVENT, onJump)
  }, [listingId])

  const refusal = refused ? teacherDmLimitMessage(refused, tr) : null
  const step = refused ? teacherDmStep(refused.next, accountType, tr) : null
  const messageLabel = busy && intent.current === 'hire' ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Message teacher', 'Nhắn tin cho giáo viên')

  /**
   * ⛔ ONE PRIMARY ON A PHONE (owner-approved 2026-11-14, cook r04 teachers — it reverses "Ask about a cover lesson" as this
   * block's cta and "Message teacher" as a button below lg). Below lg the profile's one button is "Contact teacher" (first
   * screen, then pinned — TeacherContactJump); the cover ask is a link under the week it asks about (TeacherCoverAsk), and
   * this block is the COUNSEL PANEL at the end of the page: what eno checked (`counsel`), how contact details are shared,
   * and "Message teacher" as the panel's own link. From lg nothing moved but the note: the cover ask (cta) and Message
   * (button) lead the sticky column, then the note, the Zalo reveal and a refusal.
   * Two "Message teacher" controls are in the DOM — the button (`max-lg:hidden`) and the panel link (`lg:hidden`): display:none
   * takes the other out of the accessibility tree and the tab order, so each width has ONE. Same handler, same busy label.
   */
  return (
    // `scroll-mt-24`: the jump lands it clear of the sticky header (lg:top-24 is the aside's own offset).
    <div id={TEACHER_CONTACT_ID} className="scroll-mt-24 space-y-2">
      {offerCover && (
        <Button variant="cta" className="w-full max-lg:hidden" onClick={() => start(false, 'cover')} disabled={busy}>
          {busy && intent.current === 'cover' ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Ask about a cover lesson', 'Hỏi về buổi dạy thay')}
        </Button>
      )}
      <Button variant={offerCover ? 'outline' : 'cta'} data-teacher-message="button" className="w-full max-lg:hidden" onClick={() => start(false, 'hire')} disabled={busy}>
        {messageLabel}
      </Button>
      {/* The counsel panel below lg (the shell's panel: the field, 12px corners, 16 in, 14px ink-2); from lg a plain block. */}
      <div className="space-y-3 max-lg:rounded-xl max-lg:bg-tint max-lg:p-4">
        {counsel && <div className="text-sm text-body lg:hidden">{counsel}</div>}
        <p className="text-t-meta text-muted-foreground max-lg:text-sm max-lg:text-body">
          {cover
            ? tr('The teacher’s phone, email and CV are shared with you only if they choose to: in your chat — or, for urgent cover, a Zalo number if they chose to show one to schools.', 'Số điện thoại, email và CV của giáo viên chỉ được chia sẻ với bạn nếu giáo viên đồng ý: trong cuộc trò chuyện — hoặc, với dạy thay khẩn, số Zalo nếu giáo viên đã chọn hiển thị cho các trường.')
            : tr('The teacher’s phone, email and CV are shared with you only if they choose to share them in your chat.', 'Số điện thoại, email và CV của giáo viên chỉ được chia sẻ với bạn trong cuộc trò chuyện nếu giáo viên đồng ý.')}
        </p>
        {/* The shell's standalone link: 700 14 in the accent, a 44px target, the app's chevron. */}
        <Button variant="link" size="none" data-teacher-message="link" className="relative tap-44 flex w-fit gap-1.5 text-sm font-bold text-accent-foreground lg:hidden" onClick={() => start(false, 'hire')} disabled={busy}>
          {messageLabel}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
      {/* A school only, and only while the teacher offers it to this account right now (it asks; nothing is drawn else). */}
      {cover && <CoverZaloReveal listingId={listingId} />}
      {/* ALWAYS MOUNTED (owner-approved 2026-11-14): a refusal can now start from the remote under the week, so the live region
          is in the page before anything is said into it. Empty, `empty:-mt-2` cancels the 8px the stack gives the element above
          it (its margin and this one collapse to 0), so an empty region adds nothing under the block. */}
      <div role="status" className={refusal ? 'space-y-2 text-sm text-body' : 'empty:-mt-2'}>
        {refusal && (
          <>
            <p>{refusal}</p>
            {/* In the iOS app with `ios-hide-kyc` on, a verification step is plain text naming the website, never a link. */}
            {step && (step.kyc && hideKyc
              ? <IosVerifyElsewhereNote kind={step.kyc} />
              : <Link href={step.href} className="font-semibold text-brand underline">{step.label}</Link>)}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * "Ask about a cover lesson" UNDER THE WEEK IT ASKS ABOUT (owner-approved 2026-11-14, cook r04 teachers): below lg the cover
 * ask is the shell's standalone link (700 14 accent, a chevron, a 44px target) at the end of the cover section — never a
 * second button beside "Contact teacher". Like TeacherContactJump it is a REMOTE: it scrolls to the contact block and fires
 * THAT block's action with `want: 'cover'` (sign-in for a guest, the daily limit, the queue — one set of rules), and it
 * mirrors the block's busy state (useContactBusy).
 * ⛔ ALWAYS RENDERED WITH THE SAME BOX: the block offers the cover opener to a guest and a school only (useOfferCover), and
 * once a personal account has loaded this link turns `invisible` — kept in the layout, out of the accessibility tree and
 * the tab order — so nothing under it moves when auth settles. From lg the block's own cta is the ask (`lg:hidden` here).
 */
export function TeacherCoverAsk({ listingId, className }: { listingId: string; className?: string }) {
  const { tr } = useLanguage()
  const offer = useOfferCover(true)
  const { busy, intent } = useContactBusy(listingId)
  return (
    <Button
      variant="link"
      size="none"
      data-teacher-cover-ask=""
      disabled={busy}
      className={cn('relative tap-44 gap-1.5 text-sm font-bold text-accent-foreground', !offer && 'invisible', className)}
      onClick={() => {
        document.getElementById(TEACHER_CONTACT_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
        window.dispatchEvent(new CustomEvent(TEACHER_CONTACT_EVENT, { detail: { listingId, want: 'cover' } }))
      }}
    >
      {busy && intent === 'cover' ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Ask about a cover lesson', 'Hỏi về buổi dạy thay')}
      <ChevronRight aria-hidden className="size-4" />
    </Button>
  )
}

/**
 * "Message" BESIDE THE NAME, IN THE FIRST SCREEN (rentals-12). On a phone the profile stacks and the
 * contact block falls below the bio, the teaching rows, the experience and the qualifications — a school
 * had to scroll the whole profile to find the one button. This one SCROLLS TO that block and fires ITS
 * action (TEACHER_CONTACT_EVENT), so the outcome lands where the reader now is: the sign-in sheet for a
 * guest, the daily-limit note with its next step for an account over it (the DM ladder, owner 2026-10-13), the chat
 * for everyone else.
 * ⚠️ IN FLOW, AND SINCE 2026-11-10 ALSO MIRRORED BY THE PINNED BAR once it has scrolled away (owner: item 1 of the decision
 * scorecard, which replaced the earlier "no sticky bar" rule (§6) for listing pages and profiles; pdp-action-bar.tsx has the
 * terms: it never takes the tab bar's place while the tabs are on screen, and it presses THIS button). Below lg only: on
 * desktop the contact block is the sticky right-hand column, already beside the name.
 */
export function TeacherContactJump({ listingId, className }: { listingId: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <Button
      variant="cta"
      // The profile's primary control on a phone, for the pinned bar that mirrors it (pdp-action-bar.tsx).
      data-pdp-primary="teacher"
      className={cn('relative tap-44', className)}
      onClick={() => {
        document.getElementById(TEACHER_CONTACT_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
        window.dispatchEvent(new CustomEvent(TEACHER_CONTACT_EVENT, { detail: { listingId } }))
      }}
    >
      {tr('Contact teacher', 'Liên hệ giáo viên')}
    </Button>
  )
}

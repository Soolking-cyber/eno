'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, ClipboardCheck, Info, X } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Price } from '@/components/marketplace/price'
import { useLocalized } from '@/components/marketplace/listing-content'
import { rentalFreeCta, rentalFreeLine } from '@/components/marketplace/rental-check-toggle'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { hapticConfirm, hapticError, hapticTap } from '@/lib/haptics'
import { isMockImageUrl } from '@/lib/listing-image'
import {
  RENTAL_CHECK_API,
  RENTAL_CHECK_CATEGORY_SLUG,
  RENTAL_CHECK_ID_RE,
  RENTAL_CHECK_MAX_ITEMS,
  RENTAL_CHECK_MAX_REQUIREMENTS,
  normaliseRentalContact,
  type RentalCheckChannel,
  type RentalCheckRequestBody,
  type RentalContactProblem,
} from '@/lib/rental-check/shared'
import {
  INTENT_TTL_MS,
  clearBasket,
  clearDraft,
  getBasket,
  newClientRequestId,
  readDraft,
  removeFromBasket,
  requestFingerprint,
  useRentalBasket,
  writeDraft,
  type BasketItem,
  type RentalCheckDraft,
  type RentalCheckIntent,
} from '@/lib/rental-check/store'
import type { SerializedListingCard } from '@/lib/types'
import { cn } from '@/lib/utils'

/** `send_in_flight` means another tab or an earlier press holds this request id — ask again, briefly. */
export const SEND_RETRY_MS = 1500
export const SEND_RETRIES = 3

const CONTACT_ID = 'rc-contact'
const PROBLEMS: readonly RentalContactProblem[] = ['empty', 'zalo_needs_vn_mobile', 'phone_invalid', 'email_invalid']

/**
 * The availability-check "checkout": the collected rentals, what to ask, where to reply, and one
 * button. Mobile first — at 390px it is a single column that reads top to bottom in the order the
 * visitor decides things.
 *
 * ⛔ THE SEND IS IDEMPOTENT BY A CLIENT-MINTED ID, AND EVERY PATH REUSES IT. The id is written to the
 * draft's `pending` intent BEFORE anything goes over the wire, so a network failure, a sign-in round
 * trip (dialog, OAuth redirect, a magic link opened in ANOTHER tab, /onboard and back) and a
 * `send_in_flight` retry all send the same id, and the eno team gets one card. Only an answer that
 * proves nothing was written (400/403/409-unavailable/422/429) drops it, so the next press is a new
 * request rather than a replay of the refused one.
 *
 * ⚠️ NEVER AUTO-PRUNES. A rental the refresh cannot find is MARKED, with a Remove button — the
 * visitor chose it, and a listing that is paused today may be back tomorrow; silently deleting it is
 * the favorites-context data-loss class.
 */
export function RentalCheckView() {
  const mounted = useMounted()
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, identityLoaded, accountType, openSignIn } = useAuth()
  const router = useRouter()
  const items = useRentalBasket()

  const [fresh, setFresh] = useState<Record<string, SerializedListingCard>>({})
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set())
  const evaluated = useRef<Set<string>>(new Set())

  const [draftLoaded, setDraftLoaded] = useState(false)
  const [requirements, setRequirements] = useState('')
  const [channel, setChannel] = useState<RentalCheckChannel>('whatsapp')
  // Two slots, not one: Zalo and WhatsApp share a phone number, email is its own thing, and a
  // visitor flicking between the segments should find each one as they left it.
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const phoneTouched = useRef(false)
  const emailTouched = useRef(false)
  const pending = useRef<RentalCheckIntent | undefined>(undefined)

  const [contactError, setContactError] = useState<RentalContactProblem | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [resumeNotice, setResumeNotice] = useState(false)
  const [sending, setSending] = useState(false)
  // A guest pressed while the session was still resolving: wait for it rather than drop the press.
  const [awaitingAuth, setAwaitingAuth] = useState(false)
  const [sent, setSent] = useState(false)
  const sendingRef = useRef(false)
  const autoRan = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const value = channel === 'email' ? email : phone
  const signInNote = tr(
    'Sign in to send your list — the eno team replies in Messages. Free: no fees, no markup on the rent.',
    'Đăng nhập để gửi danh sách — đội ngũ eno sẽ trả lời trong Tin nhắn. Miễn phí: không thu phí, không cộng thêm vào giá thuê.',
  )

  // ── the draft: read once, then followed ───────────────────────────────────────────────────────
  const applyDraft = (d: RentalCheckDraft | null) => {
    if (d) {
      setRequirements(d.requirements)
      setChannel(d.channel)
      if (d.channel === 'email') { setEmail(d.value); emailTouched.current = !!d.value }
      else { setPhone(d.value); phoneTouched.current = !!d.value }
      pending.current = d.pending
    } else {
      // Zalo is how Vietnam messages; everyone else reaches for WhatsApp.
      setChannel(lang === 'vi' ? 'zalo' : 'whatsapp')
    }
    setDraftLoaded(true)
  }
  /** A draft written under a signed-in account, held until the session says whose screen this is. */
  const heldDraft = useRef<RentalCheckDraft | null>(null)
  useEffect(() => {
    const d = readDraft()
    if (d?.owner) heldDraft.current = d
    else applyDraft(d)
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current) }
  }, [])
  /**
   * ⛔ AN ACCOUNT'S DRAFT IS RESTORED ONLY FOR THAT ACCOUNT. On a shared device, A signs out and B —
   * or nobody — opens this page: A's number must not appear in the form. So a draft with an owner
   * waits for the session to resolve and is discarded unless it is still A's.
   */
  useEffect(() => {
    const d = heldDraft.current
    if (!d || authLoading) return
    heldDraft.current = null
    if (user?.id === d.owner) applyDraft(d)
    else { clearDraft(); applyDraft(null) }
  }, [authLoading, user])

  /**
   * Write the form, and the intent if one is set. The intent is changed only by setIntent.
   * ⚠️ ONLY WHAT THE VISITOR TYPED IS WRITTEN DOWN. A contact prefilled from the account is not
   * persisted — it is on the account already, and a copy in localStorage would outlive a sign-out.
   */
  const persist = () => {
    const p = pending.current
    const typed = channel === 'email' ? emailTouched.current : phoneTouched.current
    writeDraft({ requirements, channel, value: typed ? value : '', owner: user?.id ?? null, ...(p ? { pending: p } : {}) })
  }
  // ⚠️ NOT a default parameter on persist(): `persist(undefined)` would apply the default and quietly
  // KEEP the intent — the one call whose whole job is to drop it. A test caught exactly that.
  const setIntent = (p: RentalCheckIntent | undefined) => {
    pending.current = p
    persist()
  }
  const dropPending = () => setIntent(undefined)

  useEffect(() => {
    if (!draftLoaded || sent) return
    // Nothing typed and nothing pending is not a draft — do not leave one behind for every visit.
    if (!requirements && !value && !pending.current) return
    persist()
  }, [draftLoaded, requirements, channel, value])

  // Prefill from the account, never over something the visitor typed.
  useEffect(() => {
    if (!draftLoaded || !user) return
    if (!phoneTouched.current && user.phone) setPhone((p) => p || `+${user.phone!.replace(/^\+/, '')}`)
    if (!emailTouched.current && user.email) setEmail((e) => e || user.email!)
  }, [draftLoaded, user])

  // ── the live check: which of the collected rentals can still be asked about ──────────────────
  const idsKey = items.map((i) => i.id).join(',')
  useEffect(() => {
    const inBasket = new Set(idsKey ? idsKey.split(',') : [])
    // ⚠️ A verdict belongs to a rental that is IN the list. However it left — the Remove button,
    // another tab, a card's chip, the clear after a send — it is forgotten here, so a re-add is asked
    // about again instead of inheriting "available" by omission.
    for (const id of Array.from(evaluated.current)) if (!inBasket.has(id)) evaluated.current.delete(id)
    setUnavailable((p) => (Array.from(p).every((id) => inBasket.has(id)) ? p : new Set(Array.from(p).filter((id) => inBasket.has(id)))))
    const ask = Array.from(inBasket).filter((id) => !evaluated.current.has(id))
    if (!ask.length) return
    const ctl = new AbortController()
    const langQ = lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''
    fetch(`/api/listings?ids=${encodeURIComponent(ask.join(','))}${langQ}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { listings?: SerializedListingCard[]; evaluated?: string[] } | null) => {
        // No `evaluated`, no verdict: an answer that does not say what it looked at proves nothing.
        if (!body || !Array.isArray(body.evaluated)) return
        const byId = new Map((Array.isArray(body.listings) ? body.listings : []).map((l) => [l.id, l]))
        const live: SerializedListingCard[] = []
        const gone: string[] = []
        for (const id of body.evaluated) {
          evaluated.current.add(id)
          const l = byId.get(id)
          if (l && l.category?.slug === RENTAL_CHECK_CATEGORY_SLUG) live.push(l)
          else gone.push(id)
        }
        if (live.length) setFresh((p) => ({ ...p, ...Object.fromEntries(live.map((l) => [l.id, l])) }))
        if (gone.length) setUnavailable((p) => new Set([...p, ...gone]))
      })
      // A failed refresh leaves the saved snapshot on screen; the server checks again at send.
      .catch(() => {})
    return () => ctl.abort()
  }, [idsKey, lang])

  const remove = (id: string) => {
    hapticTap()
    removeFromBasket(id)
    setUnavailable((p) => {
      if (!p.has(id)) return p
      const n = new Set(p)
      n.delete(id)
      return n
    })
    setFormError(null)
  }

  // ── sending ──────────────────────────────────────────────────────────────────────────────────
  const contactMessage = (r: RentalContactProblem): string =>
    r === 'empty'
      ? channel === 'email'
        ? tr('Enter your email.', 'Nhập email của bạn.')
        : channel === 'zalo'
          ? tr('Enter your Zalo number.', 'Nhập số Zalo của bạn.')
          : tr('Enter your WhatsApp number.', 'Nhập số WhatsApp của bạn.')
      : r === 'zalo_needs_vn_mobile'
        ? tr('Zalo needs a Vietnamese mobile number — or choose WhatsApp or Email.', 'Zalo cần số di động Việt Nam — hoặc chọn WhatsApp hay Email.')
        : r === 'phone_invalid'
          ? tr('Check the number and include the country code, e.g. +44 7700 900123.', 'Kiểm tra lại số và thêm mã quốc gia, ví dụ +44 7700 900123.')
          : tr('Check the email address.', 'Kiểm tra lại địa chỉ email.')

  const failContact = (r: RentalContactProblem) => {
    setContactError(r)
    hapticError()
    // By id, not a ref: FieldControl's props drop `ref`, and the id is pinned on both it and the input.
    document.getElementById(CONTACT_ID)?.focus()
  }

  /** Everything the client can check before asking the server. */
  const ready = (): boolean => {
    setFormError(null)
    setContactError(null)
    const basket = getBasket()
    if (!basket.length) return false
    if (basket.some((i) => unavailable.has(i.id))) {
      setFormError(tr('Remove the rentals that are no longer available, then send.', 'Hãy bỏ các căn không còn cho thuê rồi gửi.'))
      hapticError()
      return false
    }
    const c = normaliseRentalContact(channel, value)
    if (!c.ok) { failContact(c.reason); return false }
    return true
  }

  const bodyFor = (clientRequestId: string): RentalCheckRequestBody => ({
    listingIds: getBasket().map((i) => i.id),
    requirements: requirements.trim(),
    contact: { channel, value },
    clientRequestId,
    lang: lang === 'vi' ? 'vi' : 'en',
  })

  /** What the request SAYS, independent of its id — see RentalCheckIntent.fp. */
  const fingerprint = (): string => {
    const c = normaliseRentalContact(channel, value)
    return requestFingerprint({
      listingIds: getBasket().map((i) => i.id),
      requirements: requirements.trim(),
      channel,
      value: c.ok ? c.value : value.trim(),
    })
  }

  const send = async (body: RentalCheckRequestBody, attempt = 0): Promise<void> => {
    sendingRef.current = true
    setSending(true)
    /**
     * ⛔ A DRAFT THAT REACHES A SEND BELONGS TO THE SENDER. Stamped here — at the one moment the
     * identity is certain (a send needs a signed-in user) — so a guest who typed, signed in and then
     * hit a failed send does not leave their number restorable to the next guest for a week.
     * ⚠️ DELIBERATELY NOT an effect on `user?.id`. That was tried and all three reviewers took it
     * apart in two rounds: an identity CHANGE is ambiguous (a boot-time resolve, a magic-link return
     * that mounts already signed in, a sign-out, an account switch, a transient null), and each
     * reading needed its own branch. The send is not ambiguous. First attempt only: the in-flight
     * retries run from a timer and would write an older render's state.
     */
    if (attempt === 0) persist()
    let stayBusy = false
    try {
      const res = await fetch(RENTAL_CHECK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const err = typeof data?.error === 'string' ? data.error : null

      if (res.ok && typeof data?.conversationId === 'string') {
        stayBusy = true
        setSent(true)
        clearBasket()
        clearDraft()
        pending.current = undefined
        hapticConfirm()
        toast.success(tr('Sent to the eno team', 'Đã gửi tới đội ngũ eno'), { description: rentalFreeLine(tr) })
        const id = data.conversationId
        router.replace(RENTAL_CHECK_ID_RE.test(id) ? `/messages/${id}` : '/messages')
        return
      }
      if (res.status === 401) {
        // The session lapsed between the page and the press. Same id after sign-in.
        autoRan.current = false
        openSignIn({ note: signInNote })
        return
      }
      if (res.status === 409 && err === 'send_in_flight') {
        if (attempt < SEND_RETRIES) {
          stayBusy = true
          retryTimer.current = setTimeout(() => { void send(body, attempt + 1) }, SEND_RETRY_MS)
          return
        }
        toast(tr('Still sending — check Messages in a moment.', 'Vẫn đang gửi — xem Tin nhắn sau ít phút.'), {
          action: { label: tr('Open Messages', 'Mở Tin nhắn'), onClick: () => router.push('/messages') },
        })
        return
      }
      // ⚠️ From here every answer means NOTHING WAS WRITTEN, so the id is dropped and the next press
      // is a new request — except 503/5xx/unknown, where a retry of the SAME id is the safe one.
      if (res.status === 409 && err === 'listings_unavailable') {
        const ids = Array.isArray(data?.unavailable) ? (data.unavailable as unknown[]).filter((x): x is string => typeof x === 'string') : []
        setUnavailable((p) => new Set([...p, ...ids]))
        dropPending()
        setFormError(tr('Some rentals are no longer available — remove them, then send.', 'Một số căn không còn cho thuê — hãy bỏ chúng rồi gửi.'))
        hapticError()
        return
      }
      if (res.status === 422 && err === 'invalid_contact') {
        dropPending()
        const reason = PROBLEMS.includes(data?.reason as RentalContactProblem) ? (data!.reason as RentalContactProblem) : 'phone_invalid'
        failContact(reason)
        return
      }
      if (res.status === 429) {
        dropPending()
        toast.error(tr('Too many requests — try again in a little while.', 'Quá nhiều yêu cầu — vui lòng thử lại sau ít phút.'))
        return
      }
      if (res.status === 403) {
        dropPending()
        toast.error(tr('Your account is paused while we review it, so requests are off for now.', 'Tài khoản của bạn đang tạm ngưng để xem xét, nên tạm thời chưa gửi yêu cầu được.'))
        return
      }
      if (res.status === 400) {
        dropPending()
        toast.error(tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
        return
      }
      if (res.status === 503) {
        toast.error(tr("The eno team can't take requests right now — try again shortly.", 'Đội ngũ eno tạm thời chưa nhận yêu cầu — vui lòng thử lại sau.'))
        return
      }
      toast.error(tr('Could not send. Try again.', 'Không gửi được. Thử lại.'))
    } catch {
      toast.error(tr('Could not send — check your connection and try again.', 'Không gửi được — kiểm tra kết nối rồi thử lại.'))
    } finally {
      if (!stayBusy) {
        sendingRef.current = false
        setSending(false)
      }
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (sendingRef.current) return
    setResumeNotice(false)
    if (!ready()) return
    // The SAME id as an earlier unanswered press OF THE SAME CONTENT, re-stamped so the 15-minute
    // resume window counts from this one. ⚠️ Changed content is a new request with a new id: the
    // server dedupes on the id alone, so reusing it after the visitor removed a rental (following a
    // lost response that DID write the card) would hand back the earlier card as this one's answer.
    const fp = fingerprint()
    const prev = pending.current
    const p = { clientRequestId: prev && prev.fp === fp ? prev.clientRequestId : newClientRequestId(), at: Date.now(), fp }
    setIntent(p)
    if (!user) {
      // A guest signs in first; the resume effect below sends once they are back. ⚠️ While the
      // session is still resolving the press is HELD, not dropped: the button shows it is working,
      // and the effect after this one either opens sign-in or lets the resume send.
      if (authLoading) setAwaitingAuth(true)
      else openSignIn({ note: signInNote })
      return
    }
    autoRan.current = true
    hapticTap()
    void send(bodyFor(p.clientRequestId))
  }

  /**
   * ⛔ THE RESUME, ONCE PER PAGE LIFE. Fires when a fresh intent (<15 min) meets a signed-in,
   * ONBOARDED session: the dialog closing, an OAuth or magic-link return, a second tab, /onboard
   * handing back. ⚠️ It waits for `accountType` because a brand-new account is bounced to /onboard
   * by auth-context first; sending before that decides would race the redirect. ⚠️ An intent whose
   * draft no longer validates does NOT send — it says what happened and waits for a press.
   */
  useEffect(() => {
    if (!draftLoaded || !user || autoRan.current || sendingRef.current) return
    if (!identityLoaded || !accountType) return
    const p = pending.current
    if (!p || Date.now() - p.at > INTENT_TTL_MS) return
    autoRan.current = true
    if (!getBasket().length) { dropPending(); return }
    // ⚠️ The content must still be what was pressed: a list edited in another tab during sign-in is
    // a different request, and sending it under the old id could return the old card.
    if (
      getBasket().some((i) => unavailable.has(i.id))
      || !normaliseRentalContact(channel, value).ok
      || p.fp !== fingerprint()
    ) {
      dropPending()
      setResumeNotice(true)
      return
    }
    void send(bodyFor(p.clientRequestId))
  }, [draftLoaded, user, identityLoaded, accountType])

  // The held guest press resolves: signed out opens sign-in; signed in is the resume effect's job.
  useEffect(() => {
    if (!awaitingAuth || authLoading) return
    setAwaitingAuth(false)
    if (!user) openSignIn({ note: signInNote })
  }, [awaitingAuth, authLoading, user])

  // ── render ───────────────────────────────────────────────────────────────────────────────────
  const heading = (
    <header>
      <h1 className="h-title text-foreground">{tr('Check availability', 'Kiểm tra phòng trống')}</h1>
      <p className="mt-1.5 text-sm text-body">{rentalFreeLine(tr)}</p>
    </header>
  )

  if (!mounted) {
    return (
      <div aria-busy="true">
        {heading}
        <div className="mt-6 space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
        <p className="text-lg font-bold text-foreground">{tr('Sent to the eno team', 'Đã gửi tới đội ngũ eno')}</p>
        <p className="max-w-sm text-sm text-body">{rentalFreeLine(tr)}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner size="xs" />{tr('Opening Messages…', 'Đang mở Tin nhắn…')}</p>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div>
        {heading}
        <EmptyState
          className="mt-6"
          icon={ClipboardCheck}
          title={tr('Your list is empty', 'Danh sách đang trống')}
          subtitle={tr(
            'Tap the check button on any rental — up to 5 — and the eno team checks availability for you, free.',
            'Chạm nút kiểm tra trên bất kỳ căn nào — tối đa 5 căn — đội ngũ eno sẽ kiểm tra phòng trống giúp bạn, miễn phí.',
          )}
          action={
            <Button asChild variant="cta" className="min-h-11 px-5">
              <Link href="/c/rentals">{tr('Browse rentals', 'Xem căn cho thuê')}</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const channelLabel = channel === 'email'
    ? tr('Email', 'Email')
    : channel === 'zalo' ? tr('Zalo number', 'Số Zalo') : tr('WhatsApp number', 'Số WhatsApp')

  return (
    <div>
      {heading}
      <p className="mt-1 text-sm text-body">
        {tr('The eno team asks the landlords and replies in your Messages.', 'Đội ngũ eno sẽ hỏi chủ nhà và trả lời bạn trong mục Tin nhắn.')}
      </p>

      <section aria-labelledby="rc-list" className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="rc-list" className="text-sm font-semibold text-foreground">{tr('Your list', 'Danh sách của bạn')}</h2>
          <span className="text-xs tabular-nums text-body">{items.length}/{RENTAL_CHECK_MAX_ITEMS}</span>
        </div>
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {items.map((item) => (
            <RentalRow
              key={item.id}
              item={item}
              live={fresh[item.id]}
              unavailable={unavailable.has(item.id)}
              onRemove={() => remove(item.id)}
            />
          ))}
        </ul>
        {items.length < RENTAL_CHECK_MAX_ITEMS && (
          <Link href="/c/rentals" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent-foreground hover:underline">
            {tr('+ Add more rentals', '+ Thêm căn khác')}
          </Link>
        )}
      </section>

      <form noValidate onSubmit={onSubmit} className="mt-6 flex flex-col gap-6">
        <Field>
          <FieldLabel>
            {tr('Anything we should ask?', 'Bạn cần hỏi thêm gì?')}{' '}
            <span className="font-normal text-muted-foreground">{tr('(optional)', '(không bắt buộc)')}</span>
          </FieldLabel>
          <FieldControl
            id="rc-requirements"
            render={
              <Textarea
                id="rc-requirements"
                rows={3}
                maxLength={RENTAL_CHECK_MAX_REQUIREMENTS}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder={tr('Move-in date, how long you’ll stay, pets, parking, budget…', 'Ngày dọn vào, thời gian thuê, thú cưng, chỗ để xe, ngân sách…')}
              />
            }
          />
          <FieldDescription className="self-end tabular-nums">
            {requirements.length}/{RENTAL_CHECK_MAX_REQUIREMENTS}
          </FieldDescription>
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{tr('How should the eno team reach you?', 'Đội ngũ eno liên hệ bạn qua đâu?')}</p>
          <Segmented<RentalCheckChannel>
            aria-label={tr('Contact method', 'Cách liên hệ')}
            value={channel}
            onValueChange={(c) => { setChannel(c); setContactError(null) }}
            options={[
              { value: 'zalo', label: 'Zalo' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'email', label: tr('Email', 'Email') },
            ]}
          />
          <Field invalid={!!contactError}>
            <FieldLabel className="sr-only">{channelLabel}</FieldLabel>
            <FieldControl
              id={CONTACT_ID}
              render={
                <Input
                  id={CONTACT_ID}
                  type={channel === 'email' ? 'email' : 'tel'}
                  inputMode={channel === 'email' ? 'email' : 'tel'}
                  autoComplete={channel === 'email' ? 'email' : 'tel'}
                  value={value}
                  onChange={(e) => {
                    if (channel === 'email') { emailTouched.current = true; setEmail(e.target.value) }
                    else { phoneTouched.current = true; setPhone(e.target.value) }
                    if (contactError) setContactError(null)
                  }}
                  placeholder={channel === 'email' ? tr('name@example.com', 'ten@email.com') : channel === 'zalo' ? '0912 345 678' : '+44 7700 900123'}
                />
              }
            />
            {contactError && <FieldError>{contactMessage(contactError)}</FieldError>}
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">
          {tr(
            'Your contact goes only to eno support, to check these rentals and reply to you.',
            'Thông tin liên hệ của bạn chỉ gửi tới bộ phận hỗ trợ eno, để kiểm tra các căn này và trả lời bạn.',
          )}{' '}
          <Link href="/privacy" className="font-semibold text-accent-foreground underline-offset-2 hover:underline">
            {tr('Privacy policy', 'Chính sách quyền riêng tư')}
          </Link>
        </p>

        {resumeNotice && (
          <Alert tone="info" appearance="flat" size="xs" icon={<Info />}>
            {tr('You’re signed in — tap Check these for me.', 'Bạn đã đăng nhập — bấm Kiểm tra giúp tôi.')}
          </Alert>
        )}
        {formError && (
          <p role="alert" className="text-sm font-medium text-destructive">{formError}</p>
        )}

        <div>
          <Button type="submit" variant="cta" disabled={sending || awaitingAuth} aria-busy={sending || awaitingAuth || undefined} className="min-h-12 w-full gap-2 text-base">
            {sending || awaitingAuth
              ? <><Spinner size="sm" className="border-white border-t-transparent" />{tr('Sending…', 'Đang gửi…')}</>
              : tr('Check these for me', 'Kiểm tra giúp tôi')}
          </Button>
          <p className="mt-2 text-center text-xs text-body">{rentalFreeCta(tr)}</p>
        </div>
      </form>
    </div>
  )
}

function RentalRow({
  item,
  live,
  unavailable,
  onRemove,
}: {
  item: BasketItem
  live?: SerializedListingCard
  unavailable: boolean
  onRemove: () => void
}) {
  const { tr } = useLanguage()
  const title = useLocalized(live?.title ?? item.title, live ? live.titleVi : item.titleVi, live?.titleI18n)
  const image = live?.images?.[0] ?? item.image
  const price = live ?? item
  return (
    <li data-rental-row={item.id} data-unavailable={unavailable || undefined} className="flex items-center gap-3 py-3">
      <Link
        href={`/listings/${item.id}`}
        className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', unavailable && 'opacity-60')}
      >
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-tint">
          {image ? (
            <Image src={image} alt="" fill sizes="56px" quality={60} unoptimized={isMockImageUrl(image)} className="object-cover" />
          ) : (
            <ClipboardCheck className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{title}</span>
          {unavailable ? (
            <span className="text-xs font-semibold text-destructive">{tr('No longer available', 'Không còn cho thuê')}</span>
          ) : (
            <Price native price={price.price} currency={price.currency} priceUnit={price.priceUnit} className="text-sm" />
          )}
        </span>
      </Link>
      {unavailable ? (
        <Button type="button" variant="outline" size="sm" onClick={onRemove} className="min-h-11 shrink-0">
          {tr('Remove', 'Bỏ')}
        </Button>
      ) : (
        <IconButton aria-label={tr('Remove from list', 'Bỏ khỏi danh sách')} onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </IconButton>
      )}
    </li>
  )
}

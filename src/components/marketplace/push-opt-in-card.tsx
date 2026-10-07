'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Bell } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CloseButton } from '@/components/ui/close-button'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { consentAnswered } from '@/lib/consent'
import { askHidden, askShown, mayAsk, notePageView } from '@/lib/page-asks'
import { hasPushSubscription, optInState, readPushEnv, subscribeToPush } from '@/lib/push-subscribe'
import { cn } from '@/lib/utils'
import { IS_SERVICES } from '@/lib/edition'
import { isNativeShell } from '@/lib/native-browser'

/**
 * ── "TURN ON NOTIFICATIONS", ASKED WHERE IT PAYS (UX2 W2 B2-NOTIFY, 2026-10-05) ──────────────────────────
 *
 * Push used to be switched on only from a button deep in Settings, so almost nobody had it and a seller
 * missed the first buyer's message. This card asks at the two moments it is worth something: right after
 * publishing (PostSuccess) and on the inbox list (conversation-list.tsx).
 *
 * WHEN IT SHOWS — all of these, decided after mount (it reads the browser, so it never mismatches on
 * hydration):
 *   · SIGNED IN — a subscription belongs to an account (POST /api/push/subscribe is `auth: 'profile'`);
 *   · optInState() says 'ask' or 'ios-install' (src/lib/push-subscribe.ts: never inside the eno apps, an
 *     in-app browser, or a browser with no push; iOS outside a Home Screen app gets the install hint, never a
 *     dead button; hidden once permission is denied, or granted with a live subscription);
 *   · NOT DISMISSED ON THIS DEVICE — ✕ writes PUSH_OPTIN_DISMISSED_KEY, shared by both surfaces. Storage
 *     that cannot be READ hides the card (it could not keep "once per device", and a browser blocking site
 *     data blocks the service worker the subscription needs); a WRITE that throws keeps the dismissal in
 *     memory for this page life. Either way the page renders.
 *   · ⛔ ONE ASK AT A TIME (UX3 J7, src/lib/page-asks.ts). The card is the third ask beside the "Join eno"
 *     prompt and the app-install card: it appears only when neither is on screen nor appeared in this page
 *     view, and while it is up they wait for a later page view. The cookie bar is not in page-asks, so the
 *     card reads it the way the join prompt does (J7a, consentAnswered — read, never written): a page view
 *     in which the card found the consent UNANSWERED is the bar's, and the card sits it out even after the
 *     answer — otherwise it would pop up the moment the bar went away (agy, plan review). The /vi language
 *     banner is mounted only on the home and category-index layouts, so it never shares a page with this.
 *
 * WHAT THE COPY MAY PROMISE is what the server pushes (see push-subscribe.ts): a listing's FIRST
 * conversation, offers and counter-offers and their accept/decline. Plain chat messages do not push, so
 * nothing here says "new messages".
 */

export const PUSH_OPTIN_DISMISSED_KEY = 'eno-push-optin-dismissed'

/** The dismissal for a page life whose storage refused the write. */
let dismissedThisPageLife = false
/**
 * How many cards are registered with page-asks right now. page-asks keys by ask NAME, so with a count the
 * last card off is the one that reports 'push' hidden — one card's late hide (an answer that lands after it
 * unmounted) can never un-register another card that is still on screen (opus, diff review round 2).
 */
let cardsShown = 0
/** Tests only. */
export function __resetPushOptInForTests(): void { dismissedThisPageLife = false; cardsShown = 0 }

/** Has this device dismissed the card? null = storage cannot be read. */
function readDismissed(): boolean | null {
  if (dismissedThisPageLife) return true
  try { return window.localStorage.getItem(PUSH_OPTIN_DISMISSED_KEY) === '1' } catch { return null }
}
function writeDismissed(): void {
  dismissedThisPageLife = true
  try { window.localStorage.setItem(PUSH_OPTIN_DISMISSED_KEY, '1') } catch { /* the memory copy holds it for this page life */ }
}

/** Where the card is mounted — it picks the benefit line. */
export type PushOptInSurface = 'post' | 'job-post' | 'inbox' | 'teacher'

/** `offers: false` — a fixed-price post: the server refuses offers there (409), so the card does not promise them. */
export function PushOptInCard({ surface, offers = true, className }: { surface: PushOptInSurface; offers?: boolean; className?: string }) {
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const pathname = usePathname()
  const [mode, setMode] = useState<'ask' | 'ios-install' | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  /** The page view this card last looked at (a pathname change is a new one — page-asks' definition). */
  const viewPath = useRef<string | null>(null)
  /** This page view found the cookie consent unanswered: it is the consent bar's, and the card sits it out. */
  const consentView = useRef(false)
  /** Is THIS card counted in `cardsShown`? Each card registers once and un-registers once. */
  const registered = useRef(false)
  /** A tap in flight — a second tap before the busy state paints must not start a second subscribe. */
  const inFlight = useRef(false)
  // Set by ✕ (see `dismiss`): a subscribe that answers after the reader closed the card is ignored.
  const closed = useRef(false)
  // Stable (refs and module state only), so the effects below can list them without re-running.
  const register = useCallback((path: string | null) => {
    if (registered.current) return
    registered.current = true
    cardsShown += 1
    askShown('push', path)
  }, [])
  const unregister = useCallback(() => {
    if (!registered.current) return
    registered.current = false
    cardsShown = Math.max(0, cardsShown - 1)
    if (cardsShown === 0) askHidden('push')
  }, [])

  useEffect(() => () => unregister(), [unregister])

  useEffect(() => {
    notePageView(pathname)
    if (viewPath.current !== pathname) { viewPath.current = pathname; consentView.current = false }
    // ⚠️ BEFORE THE AUTH CHECK: any look in this page view that finds the consent unanswered makes the view
    // the bar's, even while the session is still loading — an answer given before auth resolves, or the bar
    // closing, must not open this card on the same screen. A/B/A is three views: back on A it looks again.
    if (!consentView.current && !consentAnswered()) consentView.current = true
    if (loading || !user) return
    // Already up: make sure it is counted (a remount that kept its state — StrictMode, a re-shown subtree).
    if (mode) { register(pathname); return }
    if (consentView.current) return
    let cancelled = false
    void (async () => {
      const env = readPushEnv()
      // Granted is "on" only while this browser holds a subscription — sign-out tears it down and keeps the
      // permission (auth-context.tsx), so the next account here would otherwise have no way back.
      if (env.permission === 'granted') env.subscribed = await hasPushSubscription()
      if (cancelled) return
      const state = optInState(env)
      if (state === 'hidden') return
      if (readDismissed() !== false) return
      if (!mayAsk('push', pathname)) return
      register(pathname)
      setMode(state)
    })()
    return () => { cancelled = true }
  }, [loading, user, pathname, mode, register])

  /**
   * Off the screen — every way it goes says so to page-asks right there (dismissed, answered, signed out).
   * ⛔ NOT AN EFFECT ON `[mode]`: on a mount where the session is already known (a client navigation, and
   * always on PostSuccess) the decision above runs synchronously in the FIRST commit, and an
   * `if (!mode) askHidden()` effect in that same commit still sees `mode === null` — it un-registered the
   * card the moment it registered, so a card still up after a route change no longer blocked the install
   * card in the next page view. (install-hint.tsx's version of that effect is safe only because its
   * decision never runs in its first commit.)
   */
  const hide = () => {
    setMode(null)
    unregister() // idempotent and per card: a late answer can never un-register another card
  }
  // Signed out while it is up: it goes (it asks on behalf of an account).
  useEffect(() => {
    if (!loading && !user && mode) { setMode(null); unregister() }
  }, [loading, user, mode, unregister])

  if (!mode) return null

  // ⛔ ✕ IS NEVER DISABLED (gate, 2026-10-05). Every step of a subscribe can hang — Chrome's quiet prompt holds
  // requestPermission() until the bell is clicked, a POST can stall — and a spinner with a dead ✕ is a card the
  // reader cannot get rid of. Closing marks the card gone; whatever the pending request later answers is ignored.
  const dismiss = () => {
    closed.current = true
    writeDismissed()
    hide()
  }

  const enable = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const outcome = await subscribeToPush({ permissionFirst: true })
    inFlight.current = false
    setBusy(false)
    if (closed.current) return // closed while it was pending: the reader's ✕ wins, no toast
    if (outcome === 'granted') {
      hide()
      toast.success(tr('Notifications are on for this device', 'Đã bật thông báo trên thiết bị này'))
    } else if (outcome === 'denied') {
      hide() // the browser now says no — nothing left to ask
    } else if (outcome === 'failed' || outcome === 'unsaved') {
      // Stays up for another try — a retry reuses the browser's subscription and POSTs it again. ⚠️ Left
      // without a retry, a subscription the server never stored still reads "on" on this device until
      // sign-out tears it down: the contract the Settings row has always had (push-subscribe.ts says why the
      // "drop it again" alternative was deleted).
      toast.error(tr('Couldn’t turn on notifications. Please try again.', 'Chưa bật được thông báo. Vui lòng thử lại.'))
    }
    // 'default' — the prompt was closed without an answer: the card stays, the tap can be tried again.
  }

  const benefit =
    surface === 'teacher'
      // A teacher offering cover lessons (2026-10-07): the bell + push rings when a school messages them.
      ? tr('Get notified when a school messages you about a cover lesson', 'Nhận thông báo khi có trường nhắn tin cho bạn về buổi dạy thay')
      : surface === 'job-post'
      ? tr('Get notified when the first candidate messages you', 'Nhận thông báo khi ứng viên đầu tiên nhắn tin cho bạn')
      : surface === 'post'
        ? offers
          ? tr('Get notified when the first buyer messages or makes an offer', 'Nhận thông báo khi có người mua đầu tiên nhắn tin hoặc trả giá')
          : tr('Get notified when the first buyer messages you', 'Nhận thông báo khi có người mua đầu tiên nhắn tin cho bạn')
        : tr('Get notified about offers, and when a listing of yours gets its first message', 'Nhận thông báo khi có trả giá, và khi tin đăng của bạn có tin nhắn đầu tiên')

  return (
    // ui/alert, flat info tint: a callout on the flat canvas (canon §3b), not a floating layer. `region`, not
    // the primitive's `alert` — an offer to turn something on must not be announced as an urgent error.
    <Alert
      role="region"
      aria-labelledby={titleId}
      tone="info"
      appearance="flat"
      size="md"
      data-push-optin={surface}
      className={cn('text-left', className)}
      icon={<Bell className="h-4 w-4" />}
      title={<span id={titleId}>{benefit}</span>}
      action={<CloseButton size="xs" label={tr('Dismiss', 'Đóng')} onClick={dismiss} />}
    >
      {mode === 'ios-install' ? (
        <p>
          {tr(
            'On iPhone and iPad, notifications work once eno is on your Home Screen: tap Share, then “Add to Home Screen”.',
            'Trên iPhone và iPad, thông báo chỉ hoạt động khi eno có trên Màn hình chính: nhấn Chia sẻ, rồi chọn “Thêm vào MH chính”.',
          )}
        </p>
      ) : (
        <Button variant="cta" size="sm" loading={busy} onClick={() => void enable()} className="mt-2">
          <Bell className="h-4 w-4" />
          {tr('Turn on notifications', 'Bật thông báo')}
        </Button>
      )}
    </Alert>
  )
}

/**
 * EXACTLY WHAT SENDS A PUSH, for Settings › Notifications — one line per sendPushToProfile caller a member
 * can receive (push-subscribe.ts lists them). Not listed: the rental-desk availability request (it reaches
 * only the operator account) and eno.forum's e-Visa result and payout-change alerts — this module is shared,
 * and its strings ship in eno.vn's catalogue, where visa and payment copy is a licensing leak.
 * ⚠️ A NEW PUSH ON THE SERVER IS A NEW LINE HERE, and a removed one comes out — the list is a promise.
 */
export function PushEventList({ className }: { className?: string }) {
  const { tr } = useLanguage()
  // Inside the app shell web push is off (native push is dormant — reminder-settings.tsx hides its row), so a list
  // of what sends a notification would promise pushes this reader cannot get (gate, 2026-10-05). State, not an
  // inline read, so the server render and the first paint agree.
  const [native, setNative] = useState(false)
  useEffect(() => { setNative(isNativeShell()) }, [])
  const events = [
    tr('A listing of yours gets its first message', 'Tin đăng của bạn nhận tin nhắn đầu tiên'),
    tr('Someone sends you an offer or a counter-offer, or accepts or declines yours', 'Có người trả giá hoặc trả giá lại với bạn, hoặc chấp nhận hay từ chối giá bạn đưa ra'),
    tr('Your listings need an availability check (at most once a day)', 'Tin đăng của bạn cần xác nhận còn hàng (tối đa mỗi ngày một lần)'),
    tr('A saved search has new matches', 'Tìm kiếm đã lưu có tin mới phù hợp'),
    tr('The price drops on a listing you messaged about or whose contact you viewed', 'Tin bạn từng nhắn hỏi hoặc đã xem liên hệ được giảm giá'),
    tr('A dispute case you are part of is updated', 'Hồ sơ khiếu nại liên quan đến bạn có cập nhật'),
    tr('Our moderation team sends a notice about your account (a pause, a review, an appeal decision)', 'Đội kiểm duyệt gửi thông báo về tài khoản của bạn (tạm dừng, xem xét, kết quả khiếu nại)'),
    tr('Your identity or storefront verification is reviewed', 'Hồ sơ xác minh danh tính hoặc gian hàng của bạn được xét duyệt'),
    // eno.forum also pushes its own order and application results. Named generically, on that edition only: the
    // specific words would enter eno.vn's string catalogue, which must not advertise those services (gate, 2026-10-05).
    ...(IS_SERVICES ? [tr('Updates on your orders, applications and account', 'Cập nhật về đơn hàng, hồ sơ và tài khoản của bạn')] : []),
  ]
  if (native) return null
  return (
    <div className={className} data-push-events="">
      <p className="text-sm font-bold text-foreground">{tr('What sends a notification', 'Khi nào bạn nhận được thông báo')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {events.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {tr('Ordinary chat messages don’t send a notification — they show as unread in Messages.', 'Tin nhắn trò chuyện thông thường không gửi thông báo — chúng hiện là chưa đọc trong mục Tin nhắn.')}
      </p>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Info, Loader2, Stamp } from '@/components/ui/icons'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { intlLocale } from '@/lib/i18n/langs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { hapticConfirm, hapticTap } from '@/lib/haptics'
import { pushIntent } from '@/lib/datalayer'
import { formatMoneyFull, formatUsdCents, moneyLocale } from '@/lib/vnd'
import {
  parseVisaEntryType,
  parseVisaSpeedCode,
  tierGatesSubmission,
  VISA_SPEED_SPECS,
  type VisaEntryType,
  type VisaSpeedCode,
} from '@/lib/visa/speed'
// submissionGate (NOT the raw submissionWindow) so the client live-tick agrees with the server:
// standard + day tiers always open, hour tiers close on weekends/holidays. eta.ts is client-safe.
import { submissionGate } from '@/lib/visa/eta'
import { useIosHideVisa } from '@/hooks/use-ios-hide-visa'
import { IosBrowserOnlyNote } from './ios-browser-only-note'

// ── ONE TAP → the e-Visa desk, inside a chat ──────────────────────────────────────
//
// The owner's ask: "user click chat then selects available product from admin shop and
// continues uploading images and filling up the form". This file is that tap, and nothing
// more: it names a PRODUCT and hands the applicant to the thread the server bound.
//
//   POST /api/visa/applications/start { listingId }
//     → { applicationId, conversationId, step }
//       → router.push('/messages/<conversationId>')
//
// ⚠️ NOTHING HERE AUTHORS A CARD. Card emission is server-side only, as the visa shop's own
// account (src/lib/visa/dm-thread.ts resolves the sender from getVisaShopSeller().ownerId —
// there is no sender parameter to pass). This component's entire write surface is the one
// POST above, whose body is a listing id.
//
// ⚠️ A PRODUCT, NEVER A PRICE. The prices below are DISPLAY: `priceVnd` is the admin's own
// figure off the listing and the dollars are a SERVER-ISSUED quote that arrives with it
// (src/lib/visa/fx.ts). There is no client-side FX conversion anywhere in this file and
// there must never be one — the browser's rates (src/context/currency-context) refresh
// every 12h, so converting here would show one number and capture another. Nothing money-
// shaped is ever sent back: /start takes a listing id, and the checkout route re-quotes.
//
// ⚠️ NO APPLICANT DATA. This surface reads the CATALOGUE (public marketplace facts:
// listing ids, titles, đồng prices) and never an application, a payload or a document.
//
// WHERE THIS IS MOUNTED — two entry points, one component:
//   · a visa-desk LISTING (the PDP of one of the six products) renders
//     <VisaStart listingId={listing.id} /> INSTEAD of <ContactComposer>: contacting the
//     desk about a product it sells must start that product's application, not an empty
//     chat. `isVisaShopListing(listing.id)` (src/lib/visa-shop.ts) is the server-side test.
//   · the desk's STOREFRONT — or any "chat with the visa desk" affordance that names no
//     product — renders <VisaStart /> (button + picker dialog) or <VisaStartPicker /> to
//     embed the list inline.

/** The real module — see the note in visa-start.stub.tsx for why this constant exists. */
export const VISA_START_AVAILABLE = true

/** A catalogue row as GET /api/visa/applications?catalogue=1 ships it, narrowed for display. */
export type VisaStartProduct = {
  listingId: string
  title: string
  titleVi: string | null
  entryType: VisaEntryType
  speed: VisaSpeedCode
  /** Listing.price — WHOLE ĐỒNG, the admin's authoritative number. */
  priceVnd: number
  /**
   * The SERVER'S conversion of `priceVnd`, or null when FX was unavailable.
   *
   * Only the cents survive the wire read: the rest of the server's quote (the rate, the
   * instant, the expiry) is evidence the CHECKOUT compares against, and this surface neither
   * echoes a quote nor charges anything. A null here is the honest "we cannot price this in
   * dollars right now" state — the đồng price stands alone rather than being guessed at.
   */
  usdCents: number | null
}

type CatalogueWire = { products?: unknown; payments?: unknown; encryptionReady?: unknown }

/** The picker's state — one shape so "loading", "the desk is off" and "no products" are
 *  distinguishable states rather than three flavours of empty list. */
type CatalogueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; products: VisaStartProduct[]; payable: boolean; ready: boolean }

/**
 * The catalogue out of an unknown response body — every row parsed, never trusted.
 *
 * A row that is not fully understood is DROPPED rather than half-rendered: a product with no
 * readable đồng price would advertise `undefined`, and a product with no entry type or speed
 * is one the admin has not finished setting up (the server drops those too, and the start
 * route refuses them with `product_not_configured`). Same discipline as the dashboard's
 * parseProductsWire — this is a money surface reading JSON.
 */
function parseVisaCatalogue(value: unknown): VisaStartProduct[] {
  if (!Array.isArray(value)) return []
  const products: VisaStartProduct[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const blob = row as Record<string, unknown>
    const listingId = typeof blob.listingId === 'string' ? blob.listingId.trim() : ''
    const entryType = parseVisaEntryType(blob.entryType)
    const speed = parseVisaSpeedCode(blob.speed)
    // Whole đồng: the currency has no minor unit, so a fractional price is a corrupt row.
    const priceVnd = typeof blob.priceVnd === 'number' && Number.isSafeInteger(blob.priceVnd) ? blob.priceVnd : 0
    if (!listingId || !entryType || !speed || priceVnd <= 0) continue
    const quote = blob.quote && typeof blob.quote === 'object' ? (blob.quote as Record<string, unknown>) : null
    const cents = quote?.amountUsdCents
    products.push({
      listingId,
      title: typeof blob.title === 'string' && blob.title ? blob.title : listingId,
      titleVi: typeof blob.titleVi === 'string' && blob.titleVi ? blob.titleVi : null,
      entryType,
      speed,
      priceVnd,
      usdCents: typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0 ? cents : null,
    })
  }
  return products
}

/**
 * The POST, the refusal copy and the hand-off to the thread — shared by the single-product
 * button and by every row of the picker, so the two entry points cannot drift apart.
 */
function useVisaStart(onStarted?: () => void) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)

  /**
   * A refusal code → a sentence. Every code the frozen contract can answer with is spelled
   * out: a buyer told "something went wrong" for a desk that is simply closed for the night
   * retries forever. The codes come from src/lib/visa/dm-flow.ts (VisaDmErrorCode).
   */
  const copyFor = useCallback((code: string | undefined, status: number): string => {
    switch (code) {
      case 'auth_required':
        return tr('Sign in to start your e-Visa application.', 'Đăng nhập để bắt đầu hồ sơ e-Visa.')
      case 'rate_limited':
        return tr('Too many attempts — try again in a little while.', 'Thử quá nhiều lần — vui lòng thử lại sau ít phút.')
      case 'too_many_applications':
        // The concurrent-application ceiling (dm-flow MAX_ACTIVE_VISA_APPLICATIONS). Point the
        // applicant at the cases list, where they can finish or delete one to free a slot.
        return tr(
          'You already have 10 e-Visa applications in progress. Finish or delete one in your applications list before starting a new one.',
          'Bạn đang có 10 hồ sơ e-Visa đang xử lý. Hãy hoàn tất hoặc xóa một hồ sơ trong danh sách hồ sơ trước khi bắt đầu hồ sơ mới.',
        )
      case 'listing_not_found':
        return tr('The desk no longer offers this service.', 'Dịch vụ này không còn được cung cấp.')
      case 'product_not_for_sale':
      case 'product_not_configured':
      case 'product_price_unavailable':
        return tr('This service is not available to buy right now.', 'Hiện chưa thể mua dịch vụ này.')
      case 'desk_self':
        // The account tapping IS the e-Visa desk (dm-flow's `desk_self`): nothing is down, and "try again later"
        // would send the desk owner hunting for an outage that does not exist (owner, 2026-09-14).
        return tr(
          "You're signed in as the e-Visa desk — customers apply here and their chats come to you. To try the flow, use a customer account.",
          'Bạn đang đăng nhập bằng tài khoản bộ phận e-Visa — khách hàng nộp hồ sơ tại đây và cuộc trò chuyện sẽ gửi đến bạn. Để thử quy trình, hãy dùng một tài khoản khách hàng.',
        )
      case 'shop_unavailable':
      case 'visa_encryption_not_configured':
      case 'visa_schema_not_ready':
        return tr('The e-Visa desk is unavailable right now — please try again later.', 'Bộ phận e-Visa hiện không khả dụng — vui lòng thử lại sau.')
      case 'payments_not_configured':
      case 'fx_unavailable':
        return tr('We cannot price this service right now — please try again later.', 'Hiện chưa báo được giá dịch vụ này — vui lòng thử lại sau.')
      case 'thread_conflict':
        return tr('Open Messages — your e-Visa chat is already there.', 'Mở Tin nhắn — cuộc trò chuyện e-Visa của bạn đã ở đó.')
      case 'application_changed_retry':
      case 'step_card_refused':
      case 'checkout_card_refused':
        return tr('Please try that again.', 'Vui lòng thử lại.')
      default:
        return status === 429
          ? tr('Too many attempts — try again in a little while.', 'Thử quá nhiều lần — vui lòng thử lại sau ít phút.')
          : tr("Couldn't start the application — try again.", 'Chưa bắt đầu được hồ sơ — vui lòng thử lại.')
    }
  }, [tr])

  // listingId ABSENT = the GENERIC start (Phase 2): the case opens product-less and the
  // step-0 picker card in the thread is where the service gets chosen.
  const start = useCallback(async (listingId?: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/visa/applications/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ A PRODUCT, NEVER A PRICE — the route's body schema is .strict(), so an amount
        // sent from here would be a loud 400 rather than a quietly ignored key.
        body: JSON.stringify(listingId ? { listingId } : {}),
      })
      const data = (await res.json().catch(() => null)) as { conversationId?: string; error?: string } | null
      if (!res.ok || !data?.conversationId) {
        toast.error(copyFor(data?.error, res.status))
        return
      }
      hapticConfirm()
      onStarted?.()
      // The thread the SERVER bound to the case. The step-1 card is already in it.
      router.push(`/messages/${data.conversationId}`)
    } catch {
      toast.error(tr('Network problem — try again.', 'Lỗi kết nối — vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }, [copyFor, onStarted, router, tr])

  return { busy, start }
}

/** Live "now", ticked once a minute so a picker left open stops offering a desk that closed.
 *  null until the first client tick — the window is never asserted during SSR/hydration. */
export function useMinuteTick(): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * The catalogue, fetched on mount. Re-fetched every time the picker is re-opened (this
 * component unmounts with the dialog), which is deliberate: a server-issued quote is only
 * honoured for 15 minutes, so the dollars on screen are always freshly issued.
 */
export function useVisaCatalogue(enabled: boolean): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' })
  useEffect(() => {
    // The endpoint is session-scoped (401 for a guest), so a guest is offered sign-in
    // rather than shown "the desk is unavailable" — which would be a lie about the shop.
    if (!enabled) return
    let off = false
    fetch('/api/visa/applications?catalogue=1')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: CatalogueWire | null) => {
        if (off) return
        if (!body) { setState({ status: 'error' }); return }
        setState({
          status: 'ready',
          products: parseVisaCatalogue(body.products),
          // `payments` is null while the providers are dormant — the flow still runs, but
          // the pay card at step 5 cannot be minted, and saying so up front beats a dead end.
          payable: !!body.payments,
          // The host holds the payload encryption key. false ⇒ /start answers 503, so the
          // picker refuses instead of offering a button that cannot work.
          ready: body.encryptionReady !== false,
        })
      })
      .catch(() => { if (!off) setState({ status: 'error' }) })
    return () => { off = true }
  }, [enabled])
  return state
}

/** Vietnam wall-clock time of an instant — the desk's cutoffs are Asia/Ho_Chi_Minh facts,
 *  so they are shown in that zone and labelled as such rather than silently re-zoned. */
function hcmClock(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(lang, 'en-GB'), {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function VisaProductRow({ product, now, disabled, onPick }: {
  product: VisaStartProduct
  now: Date | null
  disabled: boolean
  onPick: (listingId: string) => void
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang)
  const spec = VISA_SPEED_SPECS[product.speed]
  // The GATE is a pure function of the tier and the INSTANT (submissionGate) — the same
  // function the server uses, so the two answers cannot disagree. Standard + day tiers are
  // always open; only the hour tiers ever close (weekend/holiday or past a cutoff). Unknown
  // until the first client tick, and an unknown window never blocks a tap.
  // ⚠️ `closed` NO LONGER DISABLES THE BUTTON (owner, 2026-07-24). An hour tier outside its
  // window used to be un-tappable, which lost the customer at the door. It is applyable now and
  // the pay card discloses the real ready time before any money moves — see the checkout route.
  // The window is still computed because the row SAYS what it means ("processed next working
  // day"), which is the whole point: sell it, but never imply "within 1 hour" at 23:00.
  const window = now ? submissionGate(product.speed, now) : null
  const closed = !!window && !window.acceptingNow
  const title = lang === 'vi' ? (product.titleVi || product.title) : product.title

  return (
    <Button
      variant="outline"
      size="none"
      disabled={disabled}
      onClick={() => { hapticTap(); onPick(product.listingId) }}
      // whitespace-normal on the BUTTON (ui/button's base is whitespace-nowrap, and a
      // turnaround sentence has to wrap); the override belongs on the primitive's own
      // className so twMerge resolves it, never on a child where order would decide.
      className="w-full flex-col items-stretch gap-1.5 whitespace-normal rounded-2xl px-4 py-3 text-left"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm font-bold text-foreground">
          {tr(spec.label, spec.labelVi)}
        </span>
        <span className="shrink-0 text-sm font-bold text-foreground">
          {formatMoneyFull(product.priceVnd, '₫', locale)}
        </span>
      </span>

      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-xs font-normal text-body">{title}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          {product.usdCents === null
            ? tr('USD price unavailable', 'Chưa có giá USD')
            : `≈ ${formatUsdCents(product.usdCents, locale)}`}
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Badge variant="neutral">
          {product.entryType === 'multiple'
            ? tr('Multiple entry', 'Nhập cảnh nhiều lần')
            : tr('Single entry', 'Nhập cảnh một lần')}
        </Badge>
        {closed && window?.nextOpensIso
          ? (
            // ⚠️ NO TIME HERE. `nextOpensIso` is local MIDNIGHT (when the tier starts
            // accepting again), NOT when work begins — printing it read as "processed from
            // 00:00", which is false (codex). The honest short form is the DAY; the exact
            // ready instant is disclosed on the pay card, computed server-side.
            <Badge variant="warning">
              <Clock className="h-3 w-3" />
              {tr('Processed next working day', 'Xử lý vào ngày làm việc tiếp theo')}
            </Badge>
          )
          : window?.nextCutoffIso
            ? (
              <Badge variant="outline">
                <Clock className="h-3 w-3" />
                {tr('Cut-off', 'Giờ chốt')} {hcmClock(window.nextCutoffIso, lang)} {tr('Vietnam time', 'giờ VN')}
              </Badge>
            )
            // Non-gating tiers (standard + the day tiers) take applications at any hour, any
            // day — including weekends. Say so, so a traveller isn't left wondering about a
            // cut-off that does not apply to them.
            : !tierGatesSubmission(product.speed)
              ? (
                <Badge variant="outline">
                  <Clock className="h-3 w-3" />
                  {tr('Apply any time', 'Nộp bất cứ lúc nào')}
                </Badge>
              )
              : null}
      </span>

      <span className="text-xs font-normal text-muted-foreground">
        {lang === 'vi' ? spec.turnaroundVi : spec.turnaround}
      </span>
    </Button>
  )
}

/**
 * The desk's whole catalogue, as a list of one-tap starts. Embeddable on its own (a
 * storefront panel) or inside <VisaStart />'s dialog.
 */
export function VisaStartPicker(props: { className?: string; onStarted?: () => void }) {
  // App Store gate `ios-hide-visa` — see VisaStart below.
  return useIosHideVisa() ? null : <VisaStartPickerList {...props} />
}

function VisaStartPickerList({ className, onStarted }: { className?: string; onStarted?: () => void }) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const state = useVisaCatalogue(!!user)
  const now = useMinuteTick()
  const { busy, start } = useVisaStart(onStarted)

  // Signed out (the picker embedded on a public storefront). The catalogue read is
  // session-scoped, so the honest offer is sign-in — not an error, and not an empty shop.
  if (!user && !loading) {
    return (
      <div className={className}>
        <Button variant="cta" size="lg" onClick={() => { hapticTap(); openSignIn() }}>
          <Stamp className="h-4 w-4" />
          {tr('Sign in to start an e-Visa', 'Đăng nhập để bắt đầu e-Visa')}
        </Button>
      </div>
    )
  }
  if (state.status === 'loading' || !user) {
    return (
      <div className={className}>
        <div className="space-y-2" role="status" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <span className="sr-only">{tr('Loading services', 'Đang tải dịch vụ')}</span>
        </div>
      </div>
    )
  }
  if (state.status === 'error' || !state.ready) {
    return (
      <p className={className}>
        <span className="text-sm text-body">
          {tr('The e-Visa desk is unavailable right now — please try again later.', 'Bộ phận e-Visa hiện không khả dụng — vui lòng thử lại sau.')}
        </span>
      </p>
    )
  }
  if (!state.products.length) {
    return (
      <p className={className}>
        <span className="text-sm text-body">
          {tr('No e-Visa services are on sale right now.', 'Hiện chưa có dịch vụ e-Visa nào được bán.')}
        </span>
      </p>
    )
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        {state.products.map((product) => (
          <VisaProductRow key={product.listingId} product={product} now={now} disabled={busy} onPick={start} />
        ))}
      </div>
      {/* The weekday nuance, once, under the whole list: Vietnam Immigration works on business
          days, so the DELIVERY date is counted in working days — but a traveller can hand in a
          standard or multi-day application at any hour, any day. Only the same-day "within N
          hours" tiers must wait for the desk to be open. */}
      <p className="mt-3 text-xs text-muted-foreground">
        {tr(
          'Apply any time — including weekends. Vietnam Immigration processes on working days, so delivery times are counted in working days; only the same-day (1–4 hour) tiers pause after each day’s cut-off and on non-working days.',
          'Nộp hồ sơ bất cứ lúc nào — kể cả cuối tuần. Cục Quản lý xuất nhập cảnh xử lý vào ngày làm việc, nên thời gian trả kết quả tính theo ngày làm việc; chỉ các gói lấy nhanh trong ngày (1–4 giờ) mới tạm dừng sau giờ chốt mỗi ngày và vào ngày nghỉ.',
        )}
      </p>
      {!state.payable && (
        <p className="mt-3 text-xs text-muted-foreground">
          {tr(
            'Paying in chat is not switched on yet — start your application and the desk will confirm how to pay.',
            'Thanh toán trong chat chưa được bật — bạn cứ bắt đầu hồ sơ, bộ phận hỗ trợ sẽ hướng dẫn cách thanh toán.',
          )}
        </p>
      )}
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tr('Opening your chat…', 'Đang mở cuộc trò chuyện…')}
        </p>
      )}
    </div>
  )
}

/**
 * The start affordance.
 *
 * With a `listingId` (a visa-desk PDP) it starts THAT product straight away — one tap from
 * the listing to a thread with the step-1 card already in it. Without one (any generic
 * "Apply" / "chat with the desk" entry) it starts a PRODUCT-LESS case the same one-tap way
 * (Phase 2, owner spec): the product gets chosen IN the thread, on the step-0 picker card —
 * not in a dialog here. (The old no-listing dialog picker is gone on purpose; the inline
 * <VisaStartPicker> remains only for the storefront panel until Phase 3 removes it.)
 */
export function VisaStart(props: { listingId?: string; label?: string; className?: string }) {
  /**
   * ⚠️ APP STORE GATE `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — off by default, and then this is exactly the
   * button below. On, in the iOS app NOTHING renders: every place that mounts a start (the PDP, the cases tab) is
   * hidden or says where to apply instead, and this is the guard for one that forgets. The PDP's server HTML is
   * shared with the web, so it also wraps this in the `ios-app-hidden` hook for the first frame.
   */
  return useIosHideVisa() ? null : <VisaStartButton {...props} />
}

function VisaStartButton({ listingId, label, className }: {
  listingId?: string
  label?: string
  className?: string
}) {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const { busy, start } = useVisaStart()

  // A tap that lands while auth is still resolving is BUFFERED, not dropped (the
  // contact-composer idiom): an early tap used to silently no-op, and the recovery from
  // "nothing happened" is a second tap the user has no reason to expect they need.
  const pendingRef = useRef<{ listingId?: string } | null>(null)
  const act = useCallback((chosen?: string) => {
    if (!user) {
      if (loading) { pendingRef.current = { listingId: chosen }; return }
      openSignIn()
      return
    }
    void start(chosen)
  }, [user, loading, openSignIn, start])

  useEffect(() => {
    if (loading || !pendingRef.current) return
    const buffered = pendingRef.current
    pendingRef.current = null
    act(buffered.listingId)
    // `act` is stable per (user, loading, openSignIn, start) and re-running this on its
    // identity alone would replay a drained intent — the ref is the one-shot guard.
  }, [user, loading, act])

  return (
    <Button
      variant="cta"
      size="lg"
      className={className}
      disabled={busy}
      /**
       * ⚠️ THE INTENT PUSH COMES BEFORE `act()`, AND THE ORDER IS THE WHOLE POINT. `act()` branches:
       * a signed-out visitor is sent to sign-in and never reaches POST
       * /api/visa/applications/start, where the server-side InitiateCheckout lives. Firing here
       * means the tap is counted for the visitor an ad actually buys — a first-timer who has not
       * signed in yet. Put it inside the signed-in branch and the campaign would report almost
       * nothing while working perfectly.
       */
      onClick={() => { hapticTap(); pushIntent('apply_evisa_click', { listing_id: listingId }); act(listingId) }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
      {label ?? (listingId
        ? tr('Apply in chat', 'Nộp hồ sơ qua chat')
        : tr('Start an e-Visa in chat', 'Bắt đầu e-Visa qua chat'))}
    </Button>
  )
}

/**
 * APP STORE GATE `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — what the iOS app says where an e-Visa would have
 * been applied for: "…can be made in a web browser". The CALLER decides when it shows (an ISR page wraps it in the
 * `ios-app-only` hook; the chat thread asks useIosHideVisa), so this renders unconditionally.
 * ⛔ IT LIVES HERE, IN THE ALIASED MODULE, BECAUSE ITS WORDS ARE e-VISA VOCABULARY. Shared callers (the PDP, SeoLanding,
 * the chat thread) compile on eno.vn too — and production eno.vn builds with MARKETPLACE_HOSTS_SERVICES=true, so this
 * is the REAL module there and its words ship. ⛔ IT NAMES NO SITE (owner decision D18, 2026-10-06): the iOS app renders
 * eno.vn and is published by the licensed company, which may not send people to eno.forum for an e-Visa; a partner's
 * product (VietKite) is applied for on the site that lists it, in a web browser.
 */
export function VisaInAppNote({ kind, className }: { kind: 'apply' | 'page' | 'step' | 'thread'; className?: string }) {
  const { tr } = useLanguage()
  const text =
    kind === 'apply' ? tr('e-Visa applications are not available in the app. You can apply in a web browser.', 'Ứng dụng không hỗ trợ nộp hồ sơ e-Visa. Bạn có thể nộp hồ sơ trên trình duyệt web.')
    : kind === 'page' ? tr('In the app this page is for information only. e-Visa applications can be made in a web browser.', 'Trong ứng dụng, trang này chỉ để cung cấp thông tin. Bạn có thể nộp hồ sơ e-Visa trên trình duyệt web.')
    : kind === 'step' ? tr('This e-Visa step is available in a web browser.', 'Bước e-Visa này có trên trình duyệt web.')
    : tr('This e-Visa application continues in a web browser. You can still read the conversation here.', 'Hồ sơ e-Visa này được tiếp tục trên trình duyệt web. Bạn vẫn có thể xem cuộc trò chuyện tại đây.')
  return <IosBrowserOnlyNote text={text} className={className} />
}

/**
 * eno.vn's e-Visa disclosure (owner 2026-10-06: the flow ships in both apps via eno.vn). `@/lib/visa-provider` is stubbed
 * on every marketplace build, so VisaDisclosure renders null on eno.vn; this module is REAL there (MARKETPLACE_HOSTS_SERVICES),
 * so the words ship only where the flow does. It names the SELLER — never eno — as the one who sells and handles the
 * service, says what eno.vn is not, and links the official portal (Google Play, 2026-09-10: a clear statement plus a
 * clear, functional official URL). ⚠️ No "licensed" claim until the licence is on file (visa-provider.ts licenceOnFile).
 * ⛔ Never inside `.web-only`, never collapsed: it must render in the apps (visa-disclosure.tsx says why).
 */
// The official portal, kept out of JSX text (jsx-no-literals) — the same constant visa-provider.ts holds, which eno.vn stubs.
const OFFICIAL_PORTAL = { url: 'https://evisa.gov.vn/', host: 'evisa.gov.vn' } as const
export function VisaPartnerNote({ partner, className = '' }: { partner: string; className?: string }) {
  const { tr } = useLanguage()
  const text = fillTemplate(
    tr('This e-Visa service is sold and handled by {n}. eno.vn is the marketplace — not a government agency — and does not decide visa applications. You can always apply yourself on the official portal:', 'Dịch vụ e-Visa này do {n} bán và xử lý. eno.vn là sàn giao dịch — không phải cơ quan nhà nước — và không quyết định kết quả hồ sơ thị thực. Bạn luôn có thể tự nộp hồ sơ trên cổng thông tin chính thức:'),
    'This e-Visa service is sold and handled by {n}. eno.vn is the marketplace — not a government agency — and does not decide visa applications. You can always apply yourself on the official portal:',
    { n: partner },
  )
  return (
    <aside className={`flex max-w-3xl items-start gap-3 rounded-xl bg-tint p-4 ${className}`}>
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
      <p className="min-w-0 text-sm leading-relaxed text-body">
        {text}{' '}
        <a href={OFFICIAL_PORTAL.url} target="_blank" rel="noreferrer" className="font-semibold text-accent-foreground underline underline-offset-2">{OFFICIAL_PORTAL.host}</a>
      </p>
    </aside>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Loader2, Stamp } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { hapticConfirm, hapticTap } from '@/lib/haptics'
import { formatMoneyFull, formatUsdCents, moneyLocale } from '@/lib/vnd'
import {
  parseVisaEntryType,
  parseVisaSpeedCode,
  submissionWindow,
  VISA_SPEED_SPECS,
  type VisaEntryType,
  type VisaSpeedCode,
} from '@/lib/visa/speed'

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
      case 'listing_not_found':
        return tr('The desk no longer offers this service.', 'Dịch vụ này không còn được cung cấp.')
      case 'product_not_for_sale':
      case 'product_not_configured':
      case 'product_price_unavailable':
        return tr('This service is not available to buy right now.', 'Hiện chưa thể mua dịch vụ này.')
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

  const start = useCallback(async (listingId: string) => {
    if (!listingId) return
    setBusy(true)
    try {
      const res = await fetch('/api/visa/applications/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ A PRODUCT, NEVER A PRICE — the route's body schema is .strict(), so an amount
        // sent from here would be a loud 400 rather than a quietly ignored key.
        body: JSON.stringify({ listingId }),
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
function useMinuteTick(): Date | null {
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
function useVisaCatalogue(enabled: boolean): CatalogueState {
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
    return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function ProductRow({ product, now, disabled, onPick }: {
  product: VisaStartProduct
  now: Date | null
  disabled: boolean
  onPick: (listingId: string) => void
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang)
  const spec = VISA_SPEED_SPECS[product.speed]
  // The window is a pure function of the tier and the INSTANT (src/lib/visa/speed.ts) — the
  // same module the server uses, so the two answers cannot disagree. Unknown until the first
  // client tick, and an unknown window never blocks a tap.
  const window = now ? submissionWindow(product.speed, now) : null
  const closed = !!window && !window.acceptingNow
  const title = lang === 'vi' ? (product.titleVi || product.title) : product.title

  return (
    <Button
      variant="outline"
      size="none"
      disabled={disabled || closed}
      onClick={() => { hapticTap(); onPick(product.listingId) }}
      // whitespace-normal on the BUTTON (ui/button's base is whitespace-nowrap, and a
      // turnaround sentence has to wrap); the override belongs on the primitive's own
      // className so twMerge resolves it, never on a child where order would decide.
      className="w-full flex-col items-stretch gap-1.5 whitespace-normal rounded-2xl px-4 py-3 text-left"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm font-bold text-foreground">
          {lang === 'vi' ? spec.labelVi : spec.label}
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
            <Badge variant="warning">
              <Clock className="h-3 w-3" />
              {tr('Opens', 'Mở lại')} {hcmClock(window.nextOpensIso, lang)} {tr('Vietnam time', 'giờ VN')}
            </Badge>
          )
          : window?.nextCutoffIso
            ? (
              <Badge variant="outline">
                <Clock className="h-3 w-3" />
                {tr('Cut-off', 'Giờ chốt')} {hcmClock(window.nextCutoffIso, lang)} {tr('Vietnam time', 'giờ VN')}
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
export function VisaStartPicker({ className, onStarted }: { className?: string; onStarted?: () => void }) {
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
          <ProductRow key={product.listingId} product={product} now={now} disabled={busy} onPick={start} />
        ))}
      </div>
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
 * the listing to a thread with the step-1 card already in it. Without one (the storefront,
 * or any generic "chat with the desk" entry) it opens the picker, because a visa case cannot
 * be priced until the applicant has said which service they want.
 */
export function VisaStart({ listingId, label, className }: {
  listingId?: string
  label?: string
  className?: string
}) {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const [pickerOpen, setPickerOpen] = useState(false)
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
    if (chosen) void start(chosen)
    else setPickerOpen(true)
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
    <>
      <Button
        variant="cta"
        size="lg"
        className={className}
        disabled={busy}
        onClick={() => { hapticTap(); act(listingId) }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
        {label ?? (listingId
          ? tr('Apply in chat', 'Nộp hồ sơ qua chat')
          : tr('Start an e-Visa in chat', 'Bắt đầu e-Visa qua chat'))}
      </Button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr('Choose your e-Visa service', 'Chọn dịch vụ e-Visa')}</DialogTitle>
            <DialogDescription>
              {tr(
                'Pick a service and we will guide you through it in chat — five short steps, then pay.',
                'Chọn một dịch vụ, chúng tôi sẽ hướng dẫn bạn ngay trong chat — năm bước ngắn, sau đó thanh toán.',
              )}
            </DialogDescription>
          </DialogHeader>
          <VisaStartPicker onStarted={() => setPickerOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

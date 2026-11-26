'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Copy } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Radio, RadioDot, RadioGroup } from '@/components/ui/radio-group'
import { Segmented } from '@/components/ui/segmented'
import { QrFigure } from '@/components/marketplace/qr-figure'
import { copyText } from '@/lib/copy-text'
import { optimizedImageUrl } from '@/lib/listing-image'
import { cn } from '@/lib/utils'
import { compressImageFile, isUnsupportedPhoto, unsupportedPhotoCopy } from '@/lib/normalize-image'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { BANK_ORDER_DAYS, BANK_PERIOD, BANK_PERIODS, isBankPeriod, type BankPeriod } from '@/lib/ads/bank-periods'
import type { BankOrderView, ShopOrder } from '@/lib/ads/bank'
import type { ReviewView } from '@/lib/ads/creative-review'

/**
 * ── "Create an ad" on /dashboard/ads, paid by VietQR bank transfer (owner 2026-11-25: "our acb bank account deposit via qr
 * minimal weekly monthly quarterly ad options"; src/lib/ads/bank.ts). One short flow: what to advertise (one of the shop's
 * listings, or — while creative ads are in their private test, for admins only — its own ad), the period, a free Review
 * for an own ad, then "Pay <amount>": the order is made and its VietQR shown with the details to copy. The ad starts when eno
 * confirms the transfer. Errors are sentences, never codes.
 */

type Tr = (en: string, vi: string) => string
type Options = { bank: boolean; shop: boolean; creative: boolean; listings: { id: string; title: string; photo: string | null }[] }
type Kind = 'listing' | 'creative'
const CREATIVE_FIELDS = ['advertiserName', 'legalName', 'taxCode', 'headline', 'body', 'clickUrl', 'permitRef'] as const
type CreativeField = (typeof CREATIVE_FIELDS)[number]

/** Every refusal the order and review routes answer, as a sentence (house codes: src/app/api/ads/orders/route.ts). */
export function orderErrorText(tr: Tr, code: string | undefined, reason?: string): string {
  switch (code) {
    case 'bank_unavailable': return tr('Bank transfer isn\'t available yet.', 'Chưa thể thanh toán bằng chuyển khoản.')
    case 'no_shop': return tr('Set up your shop first.', 'Hãy tạo cửa hàng trước.')
    case 'creative_ads_not_open': return tr('Your own ads open soon.', 'Quảng cáo riêng sắp mở.')
    case 'rate_limited': return tr('Too many orders this hour. Try again later.', 'Quá nhiều đơn trong giờ này. Hãy thử lại sau.')
    case 'order_closed': return tr('This order is already closed.', 'Đơn này đã đóng.')
    case 'target_refused':
      switch (reason) {
        case 'ads_not_allowed': return tr('Listings in this category can\'t be advertised.', 'Không thể quảng cáo tin đăng thuộc danh mục này.')
        case 'not_public': return tr('Only a live, public listing can be advertised.', 'Chỉ tin đăng đang hiển thị công khai mới được quảng cáo.')
        case 'creative_review_stale': return tr('Review your ad again first.', 'Hãy kiểm duyệt lại quảng cáo trước.')
        case 'creative_removed': return tr('eno removed this ad. It can\'t run again.', 'eno đã gỡ quảng cáo này. Quảng cáo không thể chạy lại.')
        case 'creative_refused': return tr('This ad wasn\'t approved.', 'Quảng cáo này chưa được duyệt.')
        default: return tr('That isn\'t in your shop.', 'Mục này không thuộc cửa hàng của bạn.')
      }
    default: return tr('Something went wrong. Try again.', 'Đã có lỗi. Hãy thử lại.')
  }
}

const periodLabel = (tr: Tr, p: BankPeriod) => (p === 'week' ? tr('Week', 'Tuần') : p === 'month' ? tr('Month', 'Tháng') : tr('Quarter', 'Quý'))

function useOptions() {
  return useQuery({
    queryKey: ['ads-options'],
    queryFn: async (): Promise<Options> => {
      const res = await fetch('/api/ads/options', { cache: 'no-store' })
      if (!res.ok) throw new Error(`options ${res.status}`)
      return res.json()
    },
    staleTime: 60_000,
  })
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { ok: res.ok, data: (await res.json().catch(() => null)) as Record<string, unknown> | null }
  } catch {
    return { ok: false, data: null }
  }
}

/** Above this many listings the picker gets a search box (a partner shop can have up to 200 eligible). */
const SEARCH_FROM = 8
/** Search text without its accents and case: most people type Vietnamese unaccented ("xe may" finds "Xe máy"). */
export const fold = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase()

/** One radio tile's box: hairline, the brand edge and the tint when chosen (teach-area-picker.tsx's choice tiles). */
const TILE = 'flex w-full items-center justify-start gap-3 whitespace-normal rounded-xl border border-border p-2 text-left data-checked:border-brand data-checked:bg-tint'

/**
 * The form, one card (owner 2026-11-26: "make sure you bring quality simple ui ux for users to create ads"): the listing,
 * picked by its photo; how long, three priced tiles; then one button that names the amount. `onOrdered` gets the new
 * order (its QR is shown by the caller's <OrderQrDialog>); `onCancel` closes the form.
 */
export function AdOrderForm({ onOrdered, onCancel }: { onOrdered: (order: BankOrderView) => void; onCancel?: () => void }) {
  const { tr, lang } = useLanguage()
  const { data, isLoading, isError } = useOptions()
  const [kind, setKind] = useState<Kind>('listing')
  const [listingId, setListingId] = useState('')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<BankPeriod>('week')
  const [fields, setFields] = useState<Record<CreativeField, string>>({ advertiserName: '', legalName: '', taxCode: '', headline: '', body: '', clickUrl: '', permitRef: '' })
  const [imageUrl, setImageUrl] = useState('')
  const [review, setReview] = useState<ReviewView | null>(null)
  const [busy, setBusy] = useState<'upload' | 'review' | 'order' | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // Bumped by every change to the ad: a review answer that comes back after an edit is for other words, and is dropped
  // (commit gate, opus) — what is paid for is exactly what was reviewed.
  const rev = useRef(0)
  const money = (n: number) => formatMoneyFull(n, '₫', moneyLocale(lang))

  // The first eligible listing is preselected: one tap fewer for a shop with one listing.
  useEffect(() => { if (!listingId && data?.listings[0]) setListingId(data.listings[0].id) }, [data, listingId])

  if (isLoading) return <div className="h-60 animate-pulse rounded-2xl bg-muted" />
  if (isError || !data) return <p role="alert" className="text-t-meta text-destructive">{orderErrorText(tr, undefined)}</p>
  if (!data.bank) return <p className="text-t-meta text-muted-foreground">{orderErrorText(tr, 'bank_unavailable')}</p>
  if (!data.shop) return <p className="text-t-meta text-muted-foreground">{orderErrorText(tr, 'no_shop')}</p>

  const creative = kind === 'creative' && data.creative
  const approvedId = review?.status === 'approved' ? review.creative_id : null
  const ready = creative ? !!approvedId : !!listingId
  // Any change to the ad after its review asks for a new one: what is paid for is what was reviewed.
  const edit = (k: CreativeField, v: string) => { rev.current++; setFields((f) => ({ ...f, [k]: v })); setReview(null) }
  const q = fold(query.trim())
  // The chosen listing stays in the list whatever the search says, so the choice never disappears from under the button.
  const shown = q ? data.listings.filter((l) => l.id === listingId || fold(l.title).includes(q)) : data.listings

  const upload = async (file: File) => {
    setBusy('upload'); setError('')
    try {
      const form = new FormData()
      form.append('files', await compressImageFile(file))
      // 'avatar' = not watermarked: the ad's picture is the advertiser's own artwork (storefront-banner-editor.tsx).
      form.append('kind', 'avatar')
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = (await res.json().catch(() => null)) as { urls?: string[] } | null
      if (!d?.urls?.[0]) throw new Error('upload')
      rev.current++
      setImageUrl(d.urls[0]); setReview(null)
    } catch (e) {
      setError(isUnsupportedPhoto(e) ? unsupportedPhotoCopy(tr) : tr('The picture didn\'t upload. Try again.', 'Không tải được ảnh lên. Hãy thử lại.'))
    } finally {
      setBusy(null)
    }
  }

  const runReview = async () => {
    const at = rev.current
    setBusy('review'); setError('')
    const creativeBody = { ...Object.fromEntries(CREATIVE_FIELDS.map((k) => [k, fields[k].trim() || null])), imageUrl }
    const r = await postJson('/api/ads/review', { creative: creativeBody })
    setBusy(null)
    if (at !== rev.current) return
    if (r.ok && r.data?.review) setReview(r.data.review as ReviewView)
    else setError(orderErrorText(tr, r.data?.error as string | undefined))
  }

  const order = async () => {
    setBusy('order'); setError('')
    const r = await postJson('/api/ads/orders', creative ? { kind: 'creative', creativeId: approvedId, period } : { kind: 'listing', listingId, period })
    setBusy(null)
    if (r.ok && r.data?.order) onOrdered(r.data.order as BankOrderView)
    else setError(orderErrorText(tr, r.data?.error as string | undefined, r.data?.reason as string | undefined))
  }

  const text = (k: CreativeField, label: string, max: number, type: 'text' | 'url' = 'text') => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl render={<Input type={type} value={fields[k]} maxLength={max} disabled={busy === 'review'} onChange={(e) => edit(k, e.target.value)} />} />
    </Field>
  )

  return (
    // A form, not a dashboard: one readable column (2xl) rather than the full width of a computer screen.
    <Card className="max-w-2xl space-y-5 p-4 sm:p-5">
      {data.creative && (
        <Segmented
          aria-label={tr('What to advertise', 'Quảng cáo gì')}
          value={kind}
          onValueChange={(v) => { setKind(v); setError('') }}
          options={[{ value: 'listing', label: tr('Promote a listing', 'Quảng bá tin đăng') }, { value: 'creative', label: tr('My own ad', 'Quảng cáo riêng') }]}
        />
      )}

      {!creative ? (
        <section aria-labelledby="ad-listing" className="space-y-2">
          <h2 id="ad-listing" className="text-t-card font-semibold text-foreground">{tr('Listing', 'Tin đăng')}</h2>
          {!data.listings.length ? (
            <p className="text-t-meta text-muted-foreground">{tr('You have no live listing to promote yet.', 'Bạn chưa có tin đăng đang hiển thị để quảng bá.')}</p>
          ) : (
            <>
              {data.listings.length > SEARCH_FROM && (
                <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Search your listings', 'Tìm tin của bạn')} aria-label={tr('Search your listings', 'Tìm tin của bạn')} />
              )}
              {/* p-0.5: the chosen tile's focus ring is drawn inside the scroller's edge, never clipped by it. */}
              <RadioGroup aria-labelledby="ad-listing" value={listingId} onValueChange={setListingId} className="max-h-80 space-y-1.5 overflow-y-auto p-0.5">
                {shown.map((l) => (
                  <Radio key={l.id} value={l.id} className={TILE}>
                    {/* Decorative: the title beside it names the listing. */}
                    {l.photo
                      ? <img src={optimizedImageUrl(l.photo, 360)} alt="" loading="lazy" className="size-12 shrink-0 rounded-media bg-muted object-cover" />
                      : <span aria-hidden className="size-12 shrink-0 rounded-media bg-muted" />}
                    <span className="line-clamp-2 min-w-0 flex-1 text-sm text-foreground">{l.title}</span>
                    <RadioDot className="mr-1" />
                  </Radio>
                ))}
              </RadioGroup>
              {!shown.length && <p className="text-t-meta text-muted-foreground">{tr('No listing matches.', 'Không có tin nào khớp.')}</p>}
            </>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 sm:col-span-2">
            {/* The ad's own picture, decorative here: the headline beside it names the ad. */}
            {imageUrl ? <img src={imageUrl} alt="" className="size-16 shrink-0 rounded-media bg-muted object-cover" /> : null}
            {/* A native file input behind a Button: Base UI ships no file picker (ruled out), and this is the post
                wizard's and the banner editor's own way to choose a photo. */}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
            <Button type="button" variant="outline" size="sm" loading={busy === 'upload'} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {imageUrl ? tr('Change picture', 'Đổi ảnh') : tr('Add a square picture', 'Thêm ảnh vuông')}
            </Button>
          </div>
          {text('headline', tr('Headline', 'Tiêu đề'), 60)}
          {text('body', tr('Line under it (optional)', 'Dòng mô tả (không bắt buộc)'), 120)}
          {text('clickUrl', tr('Your web page (https://)', 'Trang web của bạn (https://)'), 2048, 'url')}
          {text('advertiserName', tr('Name on the ad', 'Tên trên quảng cáo'), 40)}
          {text('legalName', tr('Registered legal name', 'Tên pháp lý đã đăng ký'), 120)}
          {text('taxCode', tr('Tax or registration no. (optional)', 'Mã số thuế hoặc số đăng ký (không bắt buộc)'), 40)}
          {text('permitRef', tr('Permit no. (optional)', 'Số giấy phép (không bắt buộc)'), 80)}
        </div>
      )}

      <section aria-labelledby="ad-period" className="space-y-2">
        <h2 id="ad-period" className="text-t-card font-semibold text-foreground">{tr('How long', 'Thời hạn')}</h2>
        <RadioGroup aria-labelledby="ad-period" value={period} onValueChange={(v) => { if (isBankPeriod(v)) setPeriod(v) }} className="grid grid-cols-3 gap-2">
          {BANK_PERIODS.map((p) => (
            <Radio key={p} value={p} className={cn(TILE, 'flex-col items-start gap-0.5 p-3')}>
              <span className="text-t-meta text-muted-foreground">{periodLabel(tr, p)}</span>
              <span className="text-t-card font-semibold tabular-nums text-foreground">{money(BANK_PERIOD[p].priceVnd)}</span>
            </Radio>
          ))}
        </RadioGroup>
      </section>

      {creative && review && (
        review.status === 'approved'
          ? <p className="text-t-meta font-semibold text-success">{tr('Approved. You can pay now.', 'Đã duyệt. Bạn có thể thanh toán.')}</p>
          : (
            <div role="alert" className="space-y-1 text-t-meta text-destructive">
              {/* "Not approved" only for a verdict: a review that could not run (unavailable, the day's limit) says why alone. */}
              {(review.status === 'refused' || review.status === 'removed') && <p className="font-semibold">{tr('Not approved:', 'Chưa được duyệt:')}</p>}
              <ul className="list-disc pl-5">{review.reasons.map((r) => <li key={r.code}>{tr(r.en, r.vi)}</li>)}</ul>
            </div>
          )
      )}
      {error && <p role="alert" className="text-t-meta text-destructive">{error}</p>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {creative && !approvedId && (
            <Button type="button" variant="outline" loading={busy === 'review'} disabled={!!busy || !imageUrl} onClick={() => { void runReview() }}>
              {tr('Review (free)', 'Kiểm duyệt (miễn phí)')}
            </Button>
          )}
          <Button type="button" variant="cta" className="max-sm:w-full" loading={busy === 'order'} disabled={!!busy || !ready} onClick={() => { void order() }}>
            {tr('Pay {amount}', 'Thanh toán {amount}').replace('{amount}', money(BANK_PERIOD[period].priceVnd))}
          </Button>
          {onCancel && <Button type="button" variant="ghost" className="max-sm:w-full" disabled={busy === 'order'} onClick={onCancel}>{tr('Cancel', 'Hủy')}</Button>}
        </div>
        {/* The policy one tap from Pay (commit gate, opus): a shop's first purchase is made from this form. */}
        <p className="text-t-meta text-muted-foreground">
          {tr('By VietQR bank transfer. Your ad starts once it arrives.', 'Chuyển khoản qua VietQR. Quảng cáo bắt đầu khi nhận được tiền.')}{' '}
          <a href="/advertising-policy" className="font-semibold text-foreground underline underline-offset-2">{tr('Advertising policy', 'Chính sách quảng cáo')}</a>
        </p>
      </div>
    </Card>
  )
}

/** One copyable line of the transfer's details. */
function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { tr } = useLanguage()
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className={mono ? 'font-mono font-semibold tabular-nums' : 'font-semibold'}>{value}</span>
        <IconButton size="sm" aria-label={`${tr('Copy', 'Sao chép')} ${label}`} onClick={() => { void copyText(value).then((ok) => { if (ok) toast.success(tr('Copied', 'Đã sao chép')) }) }}>
          <Copy className="size-4" />
        </IconButton>
      </dd>
    </div>
  )
}

/**
 * How to pay an order: its VietQR, the details to type in from another phone, and "I've paid" (owner 2026-11-26: "when
 * paymen qr pops up user doesnt see paid button"). The button tells eno's admins to look for the transfer now
 * (bank.ts markPayerPaid); it starts nothing by itself: the ad starts when an admin confirms the money.
 */
export function OrderPay({ order }: { order: BankOrderView }) {
  const { tr, lang } = useLanguage()
  const qc = useQueryClient()
  const [said, setSaid] = useState<string | null>(order.payer_paid_at)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Closed while this was open (an admin's Mark paid or Cancel, or the order lapsed): the QR and the button go.
  const [closed, setClosed] = useState(false)
  if (closed) return <p role="alert" className="text-t-meta text-muted-foreground">{orderErrorText(tr, 'order_closed')}</p>
  if (order.status !== 'awaiting_transfer' || !order.pay) {
    const why = order.status === 'expired' ? tr('This order expired.', 'Đơn này đã hết hạn.')
      : order.status === 'cancelled' ? tr('This order was cancelled.', 'Đơn này đã bị hủy.')
      : order.status === 'awaiting_transfer' ? orderErrorText(tr, 'bank_unavailable')
      : tr('Paid. Your ad is on.', 'Đã thanh toán. Quảng cáo đã bật.')
    return <p className="text-t-meta text-muted-foreground">{why}</p>
  }
  const amount = formatMoneyFull(order.amount_vnd, '₫', moneyLocale(lang))
  const paid = async () => {
    setBusy(true); setError('')
    const r = await postJson(`/api/ads/orders/${encodeURIComponent(order.id)}/paid`)
    setBusy(false)
    if (r.ok) setSaid((r.data?.order as BankOrderView | undefined)?.payer_paid_at ?? new Date().toISOString())
    else if (r.data?.error === 'order_closed') setClosed(true)
    else setError(orderErrorText(tr, r.data?.error as string | undefined))
    void qc.invalidateQueries({ queryKey: ['dashboard-ads'] })
  }
  return (
    <div className="space-y-4">
      <QrFigure svg={order.pay.qr_svg} en="VietQR code to pay {amount}" vi="Mã VietQR để thanh toán {amount}" values={{ amount }} className="mx-auto w-fit rounded-2xl bg-white p-2" />
      <dl className="space-y-1 rounded-2xl bg-tint p-3 text-t-meta">
        <Detail label={tr('Bank', 'Ngân hàng')} value={order.pay.bank} />
        <Detail label={tr('Account name', 'Tên tài khoản')} value={order.pay.account_name} />
        <Detail label={tr('Account number', 'Số tài khoản')} value={order.pay.account_number} mono />
        <Detail label={tr('Amount', 'Số tiền')} value={String(order.amount_vnd)} mono />
        <Detail label={tr('Transfer note (keep as is)', 'Nội dung (giữ nguyên)')} value={order.reference} mono />
      </dl>
      {error && <p role="alert" className="text-t-meta text-destructive">{error}</p>}
      {said ? (
        <p role="status" className="text-t-meta font-semibold text-success">
          {tr('Thanks. We\'ll check the transfer and start your ad, usually within a few hours.', 'Cảm ơn bạn. Chúng tôi sẽ kiểm tra chuyển khoản và bật quảng cáo, thường trong vài giờ.')}
        </p>
      ) : (
        <>
          <Button type="button" variant="cta" className="w-full" loading={busy} disabled={busy} onClick={() => { void paid() }}>{tr('I\'ve paid', 'Tôi đã chuyển khoản')}</Button>
          <p className="text-t-meta text-muted-foreground">
            {tr(
              `Your ad starts as soon as eno confirms the transfer, usually within a few hours. Unpaid orders expire after ${BANK_ORDER_DAYS} days.`,
              `Quảng cáo bắt đầu ngay khi eno xác nhận chuyển khoản, thường trong vài giờ. Đơn chưa thanh toán sẽ hết hạn sau ${BANK_ORDER_DAYS} ngày.`,
            )}
          </p>
        </>
      )}
    </div>
  )
}

/** An order's QR in a dialog: given the order just made, or fetched by id (re-opened from the list). */
export function OrderQrDialog({ order, id, onClose }: { order?: BankOrderView | null; id?: string | null; onClose: () => void }) {
  const { tr } = useLanguage()
  const fetched = useQuery({
    queryKey: ['ads-order', id],
    enabled: !order && !!id,
    // Never a remembered QR: an order paid or cancelled since must not show its old code for a second (commit gate, opus).
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<BankOrderView> => {
      const res = await fetch(`/api/ads/orders/${encodeURIComponent(id!)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`order ${res.status}`)
      return ((await res.json()) as { order: BankOrderView }).order
    },
  })
  const shown = order ?? fetched.data ?? null
  return (
    <Dialog open={!!(order || id)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{tr('Scan to pay', 'Quét để thanh toán')}</DialogTitle></DialogHeader>
        {/* Keyed by the order: its "I've paid" state is the order's own, never the last one shown (commit gate, opus). */}
        {shown ? <OrderPay key={shown.id} order={shown} />
          : fetched.isError ? <p role="alert" className="text-t-meta text-destructive">{orderErrorText(tr, undefined)}</p>
          : <div className="h-60 animate-pulse rounded-2xl bg-muted" />}
      </DialogContent>
    </Dialog>
  )
}

/** The shop's orders awaiting their transfer: each with its QR to re-open and Cancel. */
export function AwaitingOrders({ orders, onShow }: { orders: ShopOrder[]; onShow: (id: string) => void }) {
  const { tr, lang } = useLanguage()
  const qc = useQueryClient()
  const [cancelling, setCancelling] = useState<string | null>(null)
  // Asked first: a shop that already sent the money must not close the order by reflex (commit gate, opus).
  const [confirm, setConfirm] = useState<string | null>(null)
  if (!orders.length) return null
  const cancel = async (id: string) => {
    setConfirm(null)
    setCancelling(id)
    const r = await postJson(`/api/ads/orders/${encodeURIComponent(id)}/cancel`)
    setCancelling(null)
    if (r.ok) toast.success(tr('Order cancelled.', 'Đã hủy đơn.'))
    else toast.error(orderErrorText(tr, r.data?.error as string | undefined))
    void qc.invalidateQueries({ queryKey: ['dashboard-ads'] })
  }
  return (
    <section aria-labelledby="ads-awaiting" className="max-w-2xl space-y-2">
      <h2 id="ads-awaiting" className="text-t-card font-semibold text-foreground">{tr('Awaiting transfer', 'Chờ chuyển khoản')}</h2>
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            {/* flex-row: <Card> is a column at its base, which centred this row's text over its buttons. */}
            <Card className="flex-row flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-t-card font-semibold text-foreground">{o.target ?? (o.kind === 'creative' ? tr('My own ad', 'Quảng cáo riêng') : tr('A listing', 'Một tin đăng'))}</p>
                {o.payer_paid_at && <Badge variant="neutral" size="sm" className="mt-1">{tr('Checking your transfer', 'Đang kiểm tra chuyển khoản')}</Badge>}
                <p className="text-t-meta tabular-nums text-muted-foreground">{periodLabel(tr, o.period)} · {formatMoneyFull(o.amount_vnd, '₫', moneyLocale(lang))} · <span className="font-mono">{o.reference}</span></p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="cta" onClick={() => onShow(o.id)}>{tr('Show QR', 'Xem mã QR')}</Button>
                <Button type="button" size="sm" variant="outline" loading={cancelling === o.id} disabled={!!cancelling} onClick={() => setConfirm(o.id)}>{tr('Cancel', 'Hủy')}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Cancel this order?', 'Hủy đơn này?')}</AlertDialogTitle>
            <AlertDialogDescription>{tr('Already sent the money? Keep the order: eno will start your ad.', 'Đã chuyển tiền rồi? Hãy giữ đơn: eno sẽ bật quảng cáo cho bạn.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Keep it', 'Giữ đơn')}</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => { if (confirm) void cancel(confirm) }}>{tr('Cancel order', 'Hủy đơn')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

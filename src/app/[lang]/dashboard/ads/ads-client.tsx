'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLanguage } from '@/context/language-context'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import { Rocket, TriangleAlert } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import type { DashboardAd } from '@/lib/ads/dashboard'
import { BANK_PERIOD } from '@/lib/ads/bank-periods'
import type { BankOrderView, ShopOrder } from '@/lib/ads/bank'
import { Button } from '@/components/ui/button'
import { AdOrderForm, AwaitingOrders, OrderQrDialog } from './ad-order'

/**
 * /dashboard/ads — the shop's ads with their LIVE figures (owner 2026-11-25: "realtime stats for their ads views clicks etc
 * all to industry standard"). Polls GET /api/ads/mine every 10 s, the cadence the counts are written at (src/lib/ads/stats.ts);
 * the figures already include what the server counted and has not written yet.
 * "Create an ad" (./ad-order.tsx, owner 2026-11-25) buys one by VietQR bank transfer: the order's QR, and the orders still
 * awaiting their transfer above the ads, each with its QR to re-open and Cancel (src/lib/ads/bank.ts).
 * The hourly chart is ONE series (the dataviz rule: one hue, no legend — the heading names it), thin bars 2px apart rising
 * from the baseline, a hover hint per bar (ui/tooltip), and the same numbers as a table for a screen reader.
 */
const POLL_MS = 10_000
type Metric = 'impressions' | 'clicks'

class AdsFetchError extends Error {
  constructor(public status: number) { super(`ads ${status}`) }
}
function useAds() {
  return useQuery({
    queryKey: ['dashboard-ads'],
    queryFn: async (): Promise<{ ads: DashboardAd[]; orders?: ShopOrder[]; updated_at: string }> => {
      const res = await fetch('/api/ads/mine', { cache: 'no-store' })
      if (!res.ok) throw new AdsFetchError(res.status)
      return res.json()
    },
    // Signed out: no polling and no retries — the page asks the person to sign in instead.
    refetchInterval: (q) => (q.state.error instanceof AdsFetchError && q.state.error.status === 401 ? false : POLL_MS),
    retry: (n, e) => !(e instanceof AdsFetchError && e.status === 401) && n < 2,
    refetchIntervalInBackground: false,
  })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-t-meta text-muted-foreground">{label}</p>
      <p className="text-t-h3 tabular-nums text-foreground">{value}</p>
    </div>
  )
}

const HOUR = 3_600_000
/** The last 48 CONSECUTIVE hours of the run (an hour with nothing counted is a zero bar, never a missing one, so the bars
 *  are evenly spaced in time), up to its end or now — `now` the SERVER's time (the figures' `updated_at`), never this
 *  device's clock. */
function lastHours(ad: DashboardAd, now: number): DashboardAd['hourly'] {
  if (!ad.hourly.length) return []
  const byHour = new Map(ad.hourly.map((h) => [Date.parse(h.hour_utc), h]))
  const endsAt = ad.ends_at ? Date.parse(ad.ends_at) : now
  const last = Math.floor((Math.min(now, endsAt - 1)) / HOUR) * HOUR
  const first = Math.max(Math.floor(Date.parse(ad.hourly[0]!.hour_utc) / HOUR) * HOUR, last - 47 * HOUR)
  const out: DashboardAd['hourly'] = []
  for (let t = first; t <= last; t += HOUR) {
    const ict = new Date(t + 7 * HOUR).toISOString()
    out.push(byHour.get(t) ?? { hour_utc: new Date(t).toISOString(), hour_ict: `${ict.slice(0, 10)} ${ict.slice(11, 16)} ICT`, impressions: 0, clicks: 0, invalid: 0, reach_new: 0 })
  }
  return out
}

/** The hourly series as bars: the last 48 consecutive hours, oldest first. */
function HourlyBars({ ad, metric }: { ad: DashboardAd; metric: Metric }) {
  const { tr, lang } = useLanguage()
  const hours = lastHours(ad, Date.parse(ad.updated_at))
  const max = Math.max(1, ...hours.map((h) => h[metric]))
  const nf = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US')
  const title = metric === 'impressions' ? tr('Viewable impressions per hour', 'Lượt hiển thị mỗi giờ') : tr('Clicks per hour', 'Lượt nhấp mỗi giờ')
  if (!hours.length) return <p className="text-t-meta text-muted-foreground">{tr('No views yet. Figures appear here within seconds of the first one.', 'Chưa có lượt xem. Số liệu hiện ở đây vài giây sau lượt đầu tiên.')}</p>
  return (
    <figure className="space-y-2">
      <figcaption className="text-t-meta font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">({tr('Vietnam time', 'giờ Việt Nam')})</span></figcaption>
      <div aria-hidden className="flex h-32 items-end gap-0.5 border-b border-border">
        {hours.map((h) => (
          <Tooltip key={h.hour_utc} content={`${h.hour_ict} · ${nf.format(h[metric])}`}>
            <div className="flex h-full min-w-1 flex-1 items-end">
              <div className="w-full bg-brand" style={{ height: `${Math.max(h[metric] ? 4 : 0, (h[metric] / max) * 100)}%` }} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div aria-hidden className="flex justify-between text-t-meta text-muted-foreground">
        <span>{hours[0]!.hour_ict.slice(5, 16)}</span>
        <span>{hours[hours.length - 1]!.hour_ict.slice(5, 16)}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">{tr('Hour', 'Giờ')}</th><th scope="col">{tr('Impressions', 'Lượt hiển thị')}</th><th scope="col">{tr('Clicks', 'Lượt nhấp')}</th></tr></thead>
        <tbody>{hours.map((h) => <tr key={h.hour_utc}><td>{h.hour_ict}</td><td>{h.impressions}</td><td>{h.clicks}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

function AdCard({ ad }: { ad: DashboardAd }) {
  const { tr, lang } = useLanguage()
  const [metric, setMetric] = useState<Metric>('impressions')
  const nf = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US')
  const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 })}%`)
  const vnd = (x: number | null) => (x === null ? '—' : formatMoneyFull(x, '₫', moneyLocale(lang)))
  const now = Date.now()
  const running = ad.status === 'active' && !!ad.starts_at && !!ad.ends_at && Date.parse(ad.starts_at) <= now && Date.parse(ad.ends_at) > now
  // eno's removal ends a run that had not started where it would have started: it never runs.
  const cancelled = ad.status === 'active' && !!ad.starts_at && !!ad.ends_at && Date.parse(ad.ends_at) <= Date.parse(ad.starts_at)
  const name = ad.target?.kind === 'creative' ? ad.target.headline : ad.target?.kind === 'listing' ? (ad.target.title ?? tr('A listing', 'Một tin đăng')) : tr('An ad', 'Một quảng cáo')
  const t = ad.totals
  return (
    <Card className="space-y-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        {ad.target?.kind === 'creative' && ad.target.imageUrl
          // A plain thumbnail of eno's own copy of the reviewed picture (decorative: the headline beside it names the ad).
          ? <img src={ad.target.imageUrl} alt="" className="size-14 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
          : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-t-card font-semibold text-foreground">{name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-t-meta text-muted-foreground">
            {running ? <Badge variant="success" size="sm">{tr('Running', 'Đang chạy')}</Badge>
              : cancelled ? <Badge variant="neutral" size="sm">{tr('Cancelled', 'Đã hủy')}</Badge>
              : ad.status === 'active' ? <Badge variant="neutral" size="sm">{ad.ends_at && Date.parse(ad.ends_at) <= now ? tr('Ended', 'Đã kết thúc') : tr('Scheduled', 'Đã lên lịch')}</Badge>
              : ad.status === 'review' ? <Badge variant="warning" size="sm">{tr('Being checked by hand: write to support', 'Đang được kiểm tra thủ công: hãy liên hệ hỗ trợ')}</Badge>
              : <Badge variant="warning" size="sm">{tr('Payment being confirmed', 'Đang xác nhận thanh toán')}</Badge>}
            {/* Whether anything is owed is the admin's to work out (src/lib/ads/admin.ts lists it); the policy says how to ask. */}
            {ad.target?.kind === 'creative' && ad.target.status === 'removed' && <Badge variant="warning" size="sm">{tr('Removed by eno', 'Đã bị eno gỡ')}</Badge>}
            <span>{ad.target?.kind === 'creative' ? tr('Feed card', 'Thẻ trên bảng tin') : tr('Listing first in results', 'Tin đăng hiển thị đầu')}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={tr('Impressions', 'Lượt hiển thị')} value={nf.format(t.impressions)} />
        <Stat label={tr('Clicks', 'Lượt nhấp')} value={nf.format(t.clicks)} />
        <Stat label={tr('Click-through rate', 'Tỉ lệ nhấp')} value={pct(t.ctr)} />
        <Stat label={tr('Reach', 'Số người tiếp cận')} value={nf.format(t.reach)} />
        <Stat label={tr('Frequency', 'Tần suất')} value={t.frequency === null ? '—' : t.frequency.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')} />
        {/* ⛔ In the ad's OWN money (src/lib/ads/currency.ts): đồng for an ad paid by bank transfer, USDC over x402. */}
        {t.currency === 'VND' ? (
          <>
            <Stat label={tr('Spent', 'Đã chi')} value={`${vnd(t.spend_vnd)} / ${vnd(t.paid_vnd)}`} />
            <Stat label={tr('Cost per 1,000 views', 'Chi phí mỗi 1.000 lượt xem')} value={vnd(t.ecpm_vnd)} />
            <Stat label={tr('Cost per click', 'Chi phí mỗi lượt nhấp')} value={vnd(t.ecpc_vnd)} />
          </>
        ) : (
          <>
            <Stat label={tr('Spent (USDC)', 'Đã chi (USDC)')} value={`${t.spend_usdc ?? '—'} / ${t.paid_usdc ?? '—'}`} />
            <Stat label={tr('Cost per 1,000 views', 'Chi phí mỗi 1.000 lượt xem')} value={t.ecpm_usdc ?? '—'} />
            <Stat label={tr('Cost per click', 'Chi phí mỗi lượt nhấp')} value={t.ecpc_usdc ?? '—'} />
          </>
        )}
      </div>
      {t.invalid > 0 && (
        <p className="text-t-meta text-muted-foreground">
          {tr('Left out as invalid traffic (bots, prefetches, outside the run): {n}', 'Không tính vì là lưu lượng không hợp lệ (bot, tải trước, ngoài thời gian chạy): {n}').replace('{n}', nf.format(t.invalid))}
        </p>
      )}
      <div className="space-y-3">
        <Segmented
          aria-label={tr('Chart', 'Biểu đồ')}
          value={metric}
          onValueChange={(v) => setMetric(v as Metric)}
          options={[{ value: 'impressions', label: tr('Impressions', 'Lượt hiển thị') }, { value: 'clicks', label: tr('Clicks', 'Lượt nhấp') }]}
        />
        <HourlyBars ad={ad} metric={metric} />
      </div>
    </Card>
  )
}

export function AdsClient() {
  const { tr, lang } = useLanguage()
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useAds()
  const signedOut = error instanceof AdsFetchError && error.status === 401
  // "Create an ad" (bank transfer, ./ad-order.tsx): the form, then the new order's QR; a listed order's QR by its id.
  const [creating, setCreating] = useState(false)
  const [ordered, setOrdered] = useState<BankOrderView | null>(null)
  const [showId, setShowId] = useState<string | null>(null)
  const orders = data?.orders ?? []
  const ads = data?.ads ?? []
  const empty = !!data && !ads.length && !orders.length
  /**
   * ⛔ THE BUTTON SHOWS ON EVERY SCREEN (owner 2026-11-26: "ads page is empty how can user create there"). It lived only in
   * <SectionHeader>, which is the PHONE title bar (lg:hidden), so a computer showed no title and no way to create an ad.
   * Now: the phone bar and the desktop <PageHeader> each carry it once the page has something to list; an empty page asks
   * in its own empty state instead, so the button is never on screen twice. Only once the list loaded: never offered to
   * someone signed out or mid-load. Hidden while the form is open (the form has its own Cancel).
   */
  const create = data && !empty && !creating
    ? (className?: string) => <Button type="button" variant="cta" size="sm" className={className} onClick={() => setCreating(true)}>{tr('Create an ad', 'Tạo quảng cáo')}</Button>
    : null
  return (
    <div className="space-y-4">
      <SectionHeader title={tr('Ads', 'Quảng cáo')} action={create?.()} />
      {/* The desktop title row (the phone bar above is lg:hidden). On a phone its h1 stays for the outline only, and the
          row takes no room (mb-0 against the parent's space-y). */}
      <PageHeader title={tr('Ads', 'Quảng cáo')} titleClassName="max-lg:sr-only" className="max-lg:mb-0" actions={create ? <span className="max-lg:hidden">{create()}</span> : undefined} />
      {creating && (
        <AdOrderForm
          onOrdered={(o) => { setCreating(false); setOrdered(o); void qc.invalidateQueries({ queryKey: ['dashboard-ads'] }) }}
          onCancel={() => setCreating(false)}
        />
      )}
      <OrderQrDialog order={ordered} id={showId} onClose={() => { setOrdered(null); setShowId(null) }} />
      {isLoading ? (
        <div className={cn('h-40 animate-pulse rounded-2xl bg-muted')} />
      ) : signedOut ? (
        <EmptyState title={tr('Sign in to see your ads', 'Đăng nhập để xem quảng cáo của bạn')} />
      ) : isError ? (
        <EmptyState variant="fault" icon={TriangleAlert} title={tr('The figures could not be loaded.', 'Không tải được số liệu.')} subtitle={tr('They will try again in a few seconds.', 'Hệ thống sẽ thử lại sau vài giây.')} />
      ) : empty ? (
        // The pitch and the way in, in one place; replaced by the form while it is open.
        creating ? null : (
          <EmptyState
            icon={Rocket}
            title={tr('Show your listing first', 'Đưa tin của bạn lên đầu')}
            subtitle={tr('First in the home feed, its category and matching searches, marked "Ad". From {price} a week.', 'Đứng đầu bảng tin, danh mục và kết quả tìm kiếm phù hợp, gắn nhãn "Quảng cáo". Từ {price} một tuần.').replace('{price}', formatMoneyFull(BANK_PERIOD.week.priceVnd, '₫', moneyLocale(lang)).replace(/ /g, '\u00a0'))}
            action={<Button type="button" variant="cta" onClick={() => setCreating(true)}>{tr('Create an ad', 'Tạo quảng cáo')}</Button>}
          />
        )
      ) : (
        <>
          <AwaitingOrders orders={orders} onShow={setShowId} />
          {!!ads.length && (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {ads.map((ad) => <AdCard key={ad.ad_id} ad={ad} />)}
              </div>
              {/* How the figures are counted, under them (it was a paragraph above everything, even an empty page). */}
              <p className="max-w-[60ch] text-t-meta text-muted-foreground">
                {tr(
                  'Counted to the industry standard: a view is half the ad on screen for a second, bots left out. Updates every 10 seconds.',
                  'Đếm theo chuẩn ngành: một lượt xem là khi một nửa quảng cáo hiện trên màn hình một giây, không tính bot. Cập nhật mỗi 10 giây.',
                )}{' '}
                <a href="/advertising-policy" className="font-semibold text-foreground underline underline-offset-2">{tr('Advertising policy', 'Chính sách quảng cáo')}</a>
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

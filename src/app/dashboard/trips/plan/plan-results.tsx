'use client'

// The generated-plan result surface of the trip planner, extracted verbatim from
// itinerary-builder.tsx (which keeps the wizard/state machine and renders
// <PlannerLoading> / <PlanResults> from here).
import { useState } from 'react'
import {
  ArrowRight,
  BedDouble,
  BusFront,
  CalendarCheck,
  CarFront,
  Check,
  CircleDollarSign,
  Clock3,
  CloudSun,
  Compass,
  ConciergeBell,
  Download,
  ExternalLink,
  Globe2,
  Hotel,
  Info,
  Landmark,
  Loader2,
  MapPin,
  MapPinned,
  MessagesSquare,
  MoonStar,
  Navigation,
  Plane,
  PhoneCall,
  Route,
  Save,
  SearchCheck,
  ShieldCheck,
  ShoppingBag,
  Stamp,
  Sun,
  TicketCheck,
  TrainFront,
  UtensilsCrossed,
  WalletCards,
  Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, Tr, type Language } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { localeForLanguage } from '@/lib/languages'
import { itineraryDocxTranslationSources } from '@/lib/itinerary-docx-copy'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { useDualMoney } from '@/context/currency-context'
import {
  type ActivityPlan,
  type GeneratedItineraryResponse,
} from '@/lib/itinerary-data'
import { buildItineraryResourceGroups, type ItineraryResourceKind } from '@/lib/itinerary-resources'
import { handleExternalClick } from '@/lib/native-browser'
import { requestDocxTranslations } from './plan-docx'

const RESOURCE_ICONS: Record<ItineraryResourceKind, typeof Landmark> = {
  concierge: ConciergeBell,
  marketplace: ShoppingBag,
  community: MessagesSquare,
  visa: Stamp,
  ride: CarFront,
  bus: BusFront,
  rail: TrainFront,
  flight: Plane,
  stay: Hotel,
  map: MapPinned,
  tourism: Compass,
  source: Globe2,
}

/** Locale-aware money per the app canon (full grouped amount via vnd.ts —
 *  "12,000,000 VND" / "12.000.000 đ"); zero renders the forum's "—". */
// Last gate before <a href>, mirroring safeHrefOnly in itinerary-resources.ts. Flight and stay
// urls are AI-origin: they are safeUrl'd at generation time (api/itineraries/generate/route.ts
// safeUrl → http(s) only, and `new URL(v)` with no base so a scheme-less "www.host/x" is
// rejected rather than becoming a FIRST-PARTY relative link). A plan STORED before that gate
// existed still renders straight from the row, so re-check here — a javascript:/data: href
// must never reach the DOM, whatever produced it.
const isHttpUrl = (url?: string | null): boolean => !!url && /^https?:\/\//i.test(url.trim())

/**
 * Every money figure in a generated plan, in BOTH currencies (owner, 2026-07-29: "all itinerary
 * prices they should see in both currencies approximate values") — the shared useDualMoney rule,
 * so a plan, a saved trip and a listing never show three different approximations of one amount.
 */
function useVnd() {
  const { lang } = useLanguage()
  const dual = useDualMoney()
  // '—' rather than "0 đ": a plan that did not price something has no figure, not a free one.
  return (amount: number) => (amount ? dual(amount, moneyLocale(lang)) : '—')
}

export function displayDate(date: string, locale: Language) {
  if (!date) return '—'
  return new Intl.DateTimeFormat(localeForLanguage(locale), {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

export function PlannerLoading() {
  const { tr } = useLanguage()
  return (
    <Card className="gap-0 p-5 sm:p-7" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Loader2 className="h-5 w-5 animate-spin" /></span>
        <div>
          <p className="font-bold text-foreground">{tr('Researching your trip', 'Đang nghiên cứu chuyến đi')}</p>
          <p className="mt-1 text-xs text-body">{tr('eno is checking current travel information and optimizing the route.', 'eno đang kiểm tra thông tin du lịch hiện tại và tối ưu lộ trình.')}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { Icon: Plane, label: tr('Flight routes and fare signals', 'Đường bay và tín hiệu giá vé') },
          { Icon: Hotel, label: tr('Viable stays by neighborhood', 'Chỗ ở phù hợp theo khu vực') },
          { Icon: Route, label: tr('Travel time and daily flow', 'Thời gian di chuyển và lịch mỗi ngày') },
        ].map(({ Icon, label }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl bg-tint px-3 py-3 text-xs font-semibold text-body">
            <Icon className="h-4 w-4 text-accent-foreground" />{label}
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-3" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
    </Card>
  )
}

function Activity({ icon: Icon, label, activity }: { icon: typeof Sun; label: string; activity: ActivityPlan }) {
  const vnd = useVnd()
  return (
    <div className="min-w-0 border-t border-border/70 pt-4 first:border-t-0 first:pt-0 md:border-l md:border-t-0 md:pl-4 md:pt-0 md:first:border-l-0 md:first:pl-0">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-ink-4"><Icon className="h-3.5 w-3.5 text-accent-foreground" />{label}</p>
        <span className="text-2xs font-semibold text-body">{activity.time}</span>
      </div>
      <h4 className="mt-2 text-sm font-bold text-foreground">{activity.title}</h4>
      <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-body"><MapPin className="h-3.5 w-3.5" />{activity.place}</p>
      <p className="mt-2 text-xs leading-relaxed text-body">{activity.details}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {activity.travelMinutes > 0 && <Badge variant="neutral" size="sm"><Clock3 className="h-3 w-3" />{activity.travelMinutes} <Tr text="min" /></Badge>}
        {activity.estimatedCostVnd > 0 && <Badge variant="neutral" size="sm"><CircleDollarSign className="h-3 w-3" />{vnd(activity.estimatedCostVnd)}</Badge>}
      </div>
      {activity.bookingAdvice && <p className="mt-3 text-2xs leading-relaxed text-ink-4"><TicketCheck className="mr-1 inline h-3.5 w-3.5" />{activity.bookingAdvice}</p>}
    </div>
  )
}

export function PlanResults({ result, travelers, days, onSave, saving, saved }: {
  result: GeneratedItineraryResponse
  travelers: number
  days: number
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  const { tr, lang } = useLanguage()
  const vnd = useVnd()
  const [downloading, setDownloading] = useState(false)
  const plan = result.plan
  const resourceGroups = buildItineraryResourceGroups(result)
  const resourceCount = resourceGroups.reduce((total, group) => total + group.resources.length, 0)
  const conciergeHref = `mailto:support@eno.vn?subject=${encodeURIComponent(`eno Concierge — ${plan.title}`)}&body=${encodeURIComponent(tr(
    `I would like eno Concierge to help arrange this itinerary: ${plan.title}. Please contact me about booking support.`,
    `Tôi muốn eno Concierge hỗ trợ sắp xếp lịch trình này: ${plan.title}. Vui lòng liên hệ với tôi về dịch vụ đặt chỗ.`,
  ))}`
  const practical = [
    { Icon: Navigation, label: tr('Arrival', 'Đến nơi'), text: plan.practical.arrival },
    { Icon: TrainFront, label: tr('Getting around', 'Di chuyển'), text: plan.practical.localTransport },
    { Icon: Wifi, label: tr('Connectivity', 'Kết nối'), text: plan.practical.connectivity },
    { Icon: WalletCards, label: tr('Money', 'Tiền tệ'), text: plan.practical.money },
    { Icon: CloudSun, label: tr('Weather', 'Thời tiết'), text: plan.practical.weather },
    { Icon: ShieldCheck, label: tr('Safety', 'An toàn'), text: plan.practical.safety },
  ]

  const downloadWordFile = async () => {
    setDownloading(true)
    try {
      const translations = lang === 'en' || lang === 'vi'
        ? {}
        : await requestDocxTranslations(itineraryDocxTranslationSources(result), lang)
      const response = await fetch('/api/itineraries/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result, travelers, lang, translations }),
      })
      if (!response.ok) throw new Error(`DOCX request failed (${response.status})`)
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'eno-itinerary.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      toast.message(tr('Your styled Word itinerary is ready.', 'Lịch trình Word đã sẵn sàng.'))
    } catch (error) {
      console.error('[itinerary/docx]', error)
      toast.error(tr('The Word file could not be created. Please try again.', 'Không thể tạo tệp Word. Vui lòng thử lại.'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-7 duration-300 animate-in fade-in slide-in-from-bottom-2">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="bg-brand-deep px-5 py-6 text-white sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="brand" size="sm" className="bg-white/10 text-white"><SearchCheck className="h-3.5 w-3.5" />{tr('Researched by eno', 'Được eno nghiên cứu')}</Badge>
            <span className="text-2xs font-semibold text-white/80">{tr('Researched', 'Đã nghiên cứu')} {new Date(result.generatedAt).toLocaleString(localeForLanguage(lang))}</span>
          </div>
          <h2 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">{plan.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/80">{plan.summary}</p>
          <p className="mt-4 flex items-start gap-2 text-sm font-semibold"><Route className="mt-0.5 h-4 w-4 shrink-0" />{plan.routeSummary}</p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            [tr('Trip', 'Chuyến đi'), `${days} ${tr('days', 'ngày')}`],
            [tr('Travelers', 'Khách'), String(travelers)],
            [tr('Per traveler', 'Mỗi khách'), `${vnd(plan.budget.perTravelerLowVnd)}–${vnd(plan.budget.perTravelerHighVnd)}`],
            [tr('Sources checked', 'Nguồn đã kiểm tra'), String(result.sources.length)],
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-5 py-4"><p className="text-2xs font-bold uppercase tracking-wider text-ink-4">{label}</p><p className="mt-1.5 text-sm font-bold text-foreground">{value}</p></div>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-body">{plan.budget.note}</p>
          <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
            <Button data-testid="download-itinerary-docx" type="button" variant="outline" className="h-11 w-full px-4" onClick={() => void downloadWordFile()} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? tr('Creating Word file…', 'Đang tạo tệp Word…') : tr('Download Word file', 'Tải tệp Word')}
            </Button>
            <Button type="button" variant="outline" className="h-11 w-full px-4" onClick={onSave} disabled={saving || saved}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? tr('Saving…', 'Đang lưu…') : saved ? tr('Saved', 'Đã lưu') : tr('Save plan', 'Lưu kế hoạch')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gap-0 border-brand/30 bg-accent p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white"><ConciergeBell className="h-5 w-5" /></span>
            <div>
              <h2 className="text-lg font-bold text-foreground">{tr('Want eno to handle the bookings?', 'Bạn muốn eno lo việc đặt chỗ?')}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-body">{tr('eno Concierge can arrange stays and activities, call transport providers, and coordinate the details so you can enjoy the journey. The service fee is 10% of the bookings we arrange, and you approve every cost first.', 'eno Concierge có thể đặt chỗ ở và hoạt động, gọi đơn vị vận chuyển và điều phối chi tiết để bạn tận hưởng chuyến đi. Phí dịch vụ là 10% giá trị các đặt chỗ do eno sắp xếp và bạn duyệt mọi chi phí trước.')}</p>
            </div>
          </div>
          <a href={conciergeHref} className={buttonVariants({ variant: 'cta', className: 'shrink-0' })}><PhoneCall className="h-4 w-4" />{tr('Ask eno Concierge', 'Liên hệ eno Concierge')}</a>
        </div>
      </Card>

      {plan.flights.length > 0 && (
        <section aria-labelledby="flight-options-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
            <div><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Getting there', 'Di chuyển đến nơi')}</p><h2 id="flight-options-title" className="mt-1 text-xl font-bold text-foreground">{tr('Researched flight options', 'Các lựa chọn chuyến bay đã nghiên cứu')}</h2></div>
            <Badge variant="warning" size="sm"><Info className="h-3 w-3" />{tr('Recheck fare and seats', 'Kiểm tra lại giá và chỗ')}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {plan.flights.map((flight, index) => (
              <Card key={`${flight.label}-${index}`} className="gap-0 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Plane className="h-5 w-5" /></span>
                  <Badge variant="neutral" size="sm">{flight.direction === 'domestic' ? tr('Domestic', 'Nội địa') : flight.direction === 'outbound' ? tr('Outbound', 'Chiều đi') : tr('Return', 'Chiều về')}</Badge>
                </div>
                <h3 className="mt-4 text-base font-bold text-foreground">{flight.label}</h3>
                <p className="mt-1 text-sm font-semibold text-body">{flight.route}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-2xs uppercase tracking-wide text-ink-4">{tr('When', 'Thời gian')}</p><p className="mt-1 font-semibold text-foreground">{flight.date} · {flight.departureWindow}</p></div>
                  <div><p className="text-2xs uppercase tracking-wide text-ink-4">{tr('Journey', 'Hành trình')}</p><p className="mt-1 font-semibold text-foreground">{flight.duration} · {flight.stops === 0 ? tr('Direct', 'Bay thẳng') : `${flight.stops} ${tr('stop', 'điểm dừng')}`}</p></div>
                  <div className="col-span-2"><p className="text-2xs uppercase tracking-wide text-ink-4">{tr('Operators found', 'Hãng được tìm thấy')}</p><p className="mt-1 font-semibold text-foreground">{flight.airlines.join(', ') || '—'}</p></div>
                </div>
                <p className="mt-4 text-sm font-bold text-accent-foreground">{flight.priceLowVnd ? `${vnd(flight.priceLowVnd)}–${vnd(flight.priceHighVnd)}` : tr('No defensible fare found', 'Chưa tìm thấy mức giá đáng tin')}</p>
                <p className="mt-2 text-xs leading-relaxed text-body">{flight.fareNote}</p>
                {isHttpUrl(flight.url) && <a href={flight.url} onClick={handleExternalClick} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'link', size: 'none', className: 'mt-4 h-auto justify-start p-0 text-xs font-bold' })}>{tr('Check this option', 'Kiểm tra lựa chọn này')}<ExternalLink className="h-3.5 w-3.5" /></a>}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="route-plan-title">
        <div className="mb-3 px-1"><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Route logic', 'Logic lộ trình')}</p><h2 id="route-plan-title" className="mt-1 text-xl font-bold text-foreground">{tr('Transfers without the drama', 'Di chuyển nhẹ nhàng')}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-body">{plan.routeRationale}</p></div>
        <Card className="gap-0 divide-y divide-border/70 p-0">
          {plan.routeLegs.length ? plan.routeLegs.map((leg, index) => (
            <div key={`${leg.from}-${leg.to}-${index}`} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:px-5">
              <p className="font-bold text-foreground">{leg.from}</p>
              <div className="flex items-center gap-2 text-xs font-semibold text-accent-foreground"><ArrowRight className="h-4 w-4" />{leg.mode} · {leg.duration}</div>
              <p className="text-xs leading-relaxed text-body sm:text-right"><span className="font-bold text-foreground">{leg.to}</span><span className="mt-1 block">{leg.advice}</span></p>
            </div>
          )) : <p className="px-5 py-4 text-sm text-body">{tr('No intercity transfer is needed for this route.', 'Lộ trình này không cần di chuyển liên tỉnh.')}</p>}
        </Card>
      </section>

      <section aria-labelledby="stay-options-title">
        <div className="mb-3 flex items-end justify-between gap-3 px-1"><div><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Where to stay', 'Nơi lưu trú')}</p><h2 id="stay-options-title" className="mt-1 text-xl font-bold text-foreground">{tr('Searched stay shortlist', 'Danh sách chỗ ở đã tìm kiếm')}</h2></div><Badge variant="neutral" size="sm">{plan.stays.length} {tr('options', 'lựa chọn')}</Badge></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plan.stays.map((stay, index) => (
            <Card key={`${stay.name}-${index}`} className="gap-0 p-4">
              <div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-accent-foreground"><BedDouble className="h-4 w-4" /></span><Badge variant="neutral" size="sm">{stay.category}</Badge></div>
              <p className="mt-4 text-2xs font-bold uppercase tracking-wide text-accent-foreground">{stay.city}</p>
              <h3 className="mt-1 text-sm font-bold text-foreground">{stay.name}</h3>
              <p className="mt-1 flex items-center gap-1 text-xs text-body"><MapPin className="h-3.5 w-3.5" />{stay.area}</p>
              <p className="mt-3 text-xs leading-relaxed text-body">{stay.why}</p>
              <p className="mt-3 text-xs font-bold text-accent-foreground">{vnd(stay.nightlyLowVnd)}–{vnd(stay.nightlyHighVnd)}{tr('/night', '/đêm')}</p>
              {isHttpUrl(stay.url) && <a href={stay.url} onClick={handleExternalClick} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'link', size: 'none', className: 'mt-3 h-auto justify-start p-0 text-xs font-bold' })}>{tr('View source', 'Xem nguồn')}<ExternalLink className="h-3.5 w-3.5" /></a>}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="day-plan-title">
        <div className="mb-3 px-1"><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Your days', 'Lịch từng ngày')}</p><h2 id="day-plan-title" className="mt-1 text-xl font-bold text-foreground">{tr('Day-by-day plan', 'Kế hoạch từng ngày')}</h2></div>
        <div className="space-y-4">
          {plan.days.map((day) => (
            <Card data-testid="itinerary-day" key={day.dayNumber} className="gap-0 overflow-hidden p-0">
              <div className="flex flex-col border-b border-border/70 bg-tint px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-primary text-white"><span className="text-3xs font-bold uppercase">{tr('Day', 'Ngày')}</span><span className="text-lg font-bold leading-none">{day.dayNumber}</span></span><div><p className="text-xs font-semibold text-body">{displayDate(day.date, lang)} · {day.city}</p><h3 className="mt-1 text-base font-bold text-foreground">{day.title}</h3></div></div>
                <Badge variant="brand" size="sm" className="mt-3 self-start sm:mt-0">{day.paceNote}</Badge>
              </div>
              <div className="px-4 py-4 sm:px-5">
                <p className="mb-4 text-xs leading-relaxed text-body">{day.focus}</p>
                <div className="grid gap-4 md:grid-cols-3"><Activity icon={Sun} label={tr('Morning', 'Buổi sáng')} activity={day.morning} /><Activity icon={Compass} label={tr('Afternoon', 'Buổi chiều')} activity={day.afternoon} /><Activity icon={MoonStar} label={tr('Evening', 'Buổi tối')} activity={day.evening} /></div>
                <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs sm:flex-row sm:items-start sm:justify-between"><p className="flex max-w-2xl items-start gap-2 text-body"><UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />{day.foodNote}</p><p className="shrink-0 font-bold text-foreground">{tr('Day estimate', 'Ước tính ngày')}: {vnd(day.estimatedDailyCostVnd)}</p></div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="practical-title">
        <div className="mb-3 px-1"><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Before you go', 'Trước khi đi')}</p><h2 id="practical-title" className="mt-1 text-xl font-bold text-foreground">{tr('Practical trip brief', 'Thông tin thực tế')}</h2></div>
        <div className="grid gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-3">
          {practical.map(({ Icon, label, text }) => <div key={label} className="bg-card p-4"><p className="flex items-center gap-2 text-sm font-bold text-foreground"><Icon className="h-4 w-4 text-accent-foreground" />{label}</p><p className="mt-2 text-xs leading-relaxed text-body">{text}</p></div>)}
        </div>
      </section>

      <section aria-labelledby="booking-title">
        <div className="mb-3 px-1"><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Action plan', 'Kế hoạch đặt chỗ')}</p><h2 id="booking-title" className="mt-1 text-xl font-bold text-foreground">{tr('What to book, and when', 'Nên đặt gì và khi nào')}</h2></div>
        <Card className="gap-0 divide-y divide-border/70 p-0">
          {plan.bookingChecklist.map((item, index) => <div key={`${item.item}-${index}`} className="grid gap-2 px-4 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:px-5"><p className="flex items-center gap-2 text-xs font-bold text-accent-foreground"><CalendarCheck className="h-4 w-4" />{item.when}</p><div><p className="text-sm font-bold text-foreground">{item.item}</p><p className="mt-1 text-xs leading-relaxed text-body">{item.reason}</p></div></div>)}
        </Card>
      </section>

      <section aria-labelledby="resources-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Prepare before you go', 'Chuẩn bị trước chuyến đi')}</p>
            <h2 id="resources-title" className="mt-1 text-xl font-bold text-foreground">{tr('Travel services and plan links', 'Dịch vụ du lịch và liên kết lịch trình')}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-body">{tr('Booking, transport, visa, community, maps, and every link from this itinerary—collected in one place and included in your Word file.', 'Đặt chỗ, di chuyển, visa, cộng đồng, bản đồ và mọi liên kết trong lịch trình—được tập hợp tại một nơi và đưa vào tệp Word.')}</p>
          </div>
          <Badge variant="brand" size="sm"><Globe2 className="h-3 w-3" />{resourceCount} {tr('useful links', 'liên kết hữu ích')}</Badge>
        </div>
        <div className="space-y-3">
          {resourceGroups.map((group) => (
            <Card data-testid="itinerary-resource-group" key={group.id} className="gap-0 border-line-strong p-4 sm:p-5">
              <div>
                <h3 className="text-sm font-bold text-foreground">{tr(group.title, group.titleVi)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-body">{tr(group.description, group.descriptionVi)}</p>
              </div>
              <div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.resources.map((resource) => {
                  const ResourceIcon = RESOURCE_ICONS[resource.kind]
                  const opensNewTab = resource.url.startsWith('http')
                  return (
                    <a data-testid="itinerary-resource-link" key={resource.url} href={resource.url} target={opensNewTab ? '_blank' : undefined} rel={opensNewTab ? 'noreferrer' : undefined} className={buttonVariants({ variant: 'bare', size: 'none', className: 'group/resource h-full min-h-28 min-w-0 w-full items-start justify-start gap-3 overflow-hidden whitespace-normal rounded-2xl border border-line-strong bg-card px-4 py-4 text-left hover:border-brand/40 hover:bg-tint' })}>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-accent-foreground transition-colors group-hover/resource:bg-accent"><ResourceIcon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-xs font-bold leading-5 text-foreground"><span className="min-w-0 break-words">{tr(resource.title, resource.titleVi)}</span><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4" /></span>
                          <span className="mt-1.5 block min-w-0 break-words text-2xs leading-relaxed text-body [overflow-wrap:anywhere]">{tr(resource.description, resource.descriptionVi)}</span>
                        </span>
                    </a>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {plan.assumptions.length > 0 && (
        <Card className="gap-0 bg-accent p-4 text-accent-foreground">
          <p className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4" />{tr('Planning assumptions', 'Giả định khi lập kế hoạch')}</p>
          <ul className="mt-2 space-y-1.5 pl-5 text-xs leading-relaxed list-disc">{plan.assumptions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </Card>
      )}

      <p className="px-1 text-2xs leading-relaxed text-ink-4">{tr('This plan is a travel aid, not confirmed inventory. Seats, fares, rooms, opening hours, visa rules, and weather can change. Confirm important details before paying, or ask eno Concierge to arrange them for you.', 'Kế hoạch này hỗ trợ chuyến đi, không phải tình trạng chỗ đã xác nhận. Chỗ ngồi, giá vé, phòng, giờ mở cửa, quy định thị thực và thời tiết có thể thay đổi. Hãy xác nhận trước khi thanh toán hoặc nhờ eno Concierge sắp xếp.')}</p>
    </div>
  )
}

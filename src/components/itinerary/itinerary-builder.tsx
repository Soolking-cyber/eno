'use client'

import { useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  CloudSun,
  Compass,
  ExternalLink,
  Footprints,
  Globe2,
  Hotel,
  Info,
  Landmark,
  Loader2,
  Luggage,
  Map,
  MapPin,
  MapPinned,
  MoonStar,
  Navigation,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Save,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Sun,
  TicketCheck,
  TrainFront,
  UtensilsCrossed,
  Users,
  WalletCards,
  Wifi,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Radio, RadioDot, RadioGroup } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { ForumApiError, forumApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  addDays,
  BUDGETS,
  CITIES,
  CITY_MAP,
  formatVnd,
  type AccommodationId,
  type ActivityPlan,
  type BudgetId,
  type CabinId,
  type CityId,
  type GeneratedItineraryResponse,
  type GeneratedPlan,
  type InterestId,
  type PaceId,
  type StopsId,
} from './itinerary-data'

const INTERESTS: Array<{ id: InterestId; label: string; labelVi: string; Icon: typeof Landmark }> = [
  { id: 'food', label: 'Food', labelVi: 'Ẩm thực', Icon: UtensilsCrossed },
  { id: 'culture', label: 'Culture', labelVi: 'Văn hóa', Icon: Landmark },
  { id: 'nature', label: 'Nature', labelVi: 'Thiên nhiên', Icon: CloudSun },
  { id: 'beaches', label: 'Beaches', labelVi: 'Biển', Icon: Sun },
  { id: 'adventure', label: 'Adventure', labelVi: 'Phiêu lưu', Icon: Footprints },
  { id: 'nightlife', label: 'Nightlife', labelVi: 'Về đêm', Icon: MoonStar },
  { id: 'wellness', label: 'Wellness', labelVi: 'Nghỉ dưỡng', Icon: Sparkles },
  { id: 'family', label: 'Family', labelVi: 'Gia đình', Icon: Users },
]

const ACCOMMODATIONS: Array<{ id: AccommodationId; label: string; labelVi: string }> = [
  { id: 'hotel', label: 'Reliable hotels', labelVi: 'Khách sạn uy tín' },
  { id: 'boutique', label: 'Boutique stays', labelVi: 'Khách sạn boutique' },
  { id: 'resort', label: 'Resorts', labelVi: 'Khu nghỉ dưỡng' },
  { id: 'apartment', label: 'Serviced apartments', labelVi: 'Căn hộ dịch vụ' },
  { id: 'homestay', label: 'Local homestays', labelVi: 'Homestay địa phương' },
  { id: 'hostel', label: 'Social hostels', labelVi: 'Hostel giao lưu' },
]

const PACES: Array<{ id: PaceId; label: string; labelVi: string; detail: string; detailVi: string }> = [
  { id: 'slow', label: 'Slow', labelVi: 'Thong thả', detail: 'One main anchor each day', detailVi: 'Một hoạt động chính mỗi ngày' },
  { id: 'balanced', label: 'Balanced', labelVi: 'Cân bằng', detail: 'Highlights with breathing room', detailVi: 'Điểm nổi bật với thời gian nghỉ' },
  { id: 'full', label: 'Full', labelVi: 'Nhiều trải nghiệm', detail: 'More activity, still geographically sensible', detailVi: 'Nhiều hoạt động nhưng vẫn hợp lý' },
]

function displayDate(date: string, locale: 'en' | 'vi') {
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function FormSection({ icon: Icon, title, subtitle, children }: {
  icon: typeof MapPin
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-border/80 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-body">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function PlannerLoading() {
  const { tr } = useLanguage()
  return (
    <Card className="gap-0 p-5 sm:p-7" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Loader2 className="h-5 w-5 animate-spin" /></span>
        <div>
          <p className="font-bold text-foreground">{tr('Researching your trip', 'Đang nghiên cứu chuyến đi')}</p>
          <p className="mt-1 text-xs text-body">{tr('Gemini is checking the web and optimizing the route.', 'Gemini đang kiểm tra web và tối ưu lộ trình.')}</p>
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
        {activity.travelMinutes > 0 && <Badge variant="neutral" size="sm"><Clock3 className="h-3 w-3" />{activity.travelMinutes} min</Badge>}
        {activity.estimatedCostVnd > 0 && <Badge variant="neutral" size="sm"><CircleDollarSign className="h-3 w-3" />{formatVnd(activity.estimatedCostVnd)}</Badge>}
      </div>
      {activity.bookingAdvice && <p className="mt-3 text-2xs leading-relaxed text-ink-4"><TicketCheck className="mr-1 inline h-3.5 w-3.5" />{activity.bookingAdvice}</p>}
    </div>
  )
}

function PlanResults({ result, travelers, days, onSave, saving, saved }: {
  result: GeneratedItineraryResponse
  travelers: number
  days: number
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  const { tr, lang } = useLanguage()
  const plan = result.plan
  const practical = [
    { Icon: Navigation, label: tr('Arrival', 'Đến nơi'), text: plan.practical.arrival },
    { Icon: TrainFront, label: tr('Getting around', 'Di chuyển'), text: plan.practical.localTransport },
    { Icon: Wifi, label: tr('Connectivity', 'Kết nối'), text: plan.practical.connectivity },
    { Icon: WalletCards, label: tr('Money', 'Tiền tệ'), text: plan.practical.money },
    { Icon: CloudSun, label: tr('Weather', 'Thời tiết'), text: plan.practical.weather },
    { Icon: ShieldCheck, label: tr('Safety', 'An toàn'), text: plan.practical.safety },
  ]

  return (
    <div className="space-y-7 duration-300 animate-in fade-in slide-in-from-bottom-2">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="bg-brand-deep px-5 py-6 text-white sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="brand" size="sm" className="bg-white/10 text-white"><SearchCheck className="h-3.5 w-3.5" />Gemini 3.5 Flash + Google Search</Badge>
            <span className="text-2xs font-semibold text-white/80">{tr('Researched', 'Đã nghiên cứu')} {new Date(result.generatedAt).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB')}</span>
          </div>
          <h2 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">{plan.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/80">{plan.summary}</p>
          <p className="mt-4 flex items-start gap-2 text-sm font-semibold"><Route className="mt-0.5 h-4 w-4 shrink-0" />{plan.routeSummary}</p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            [tr('Trip', 'Chuyến đi'), `${days} ${tr('days', 'ngày')}`],
            [tr('Travelers', 'Khách'), String(travelers)],
            [tr('Per traveler', 'Mỗi khách'), `${formatVnd(plan.budget.perTravelerLowVnd)}–${formatVnd(plan.budget.perTravelerHighVnd)}`],
            [tr('Sources checked', 'Nguồn đã kiểm tra'), String(result.sources.length)],
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-5 py-4"><p className="text-2xs font-bold uppercase tracking-wider text-ink-4">{label}</p><p className="mt-1.5 text-sm font-bold text-foreground">{value}</p></div>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-body">{plan.budget.note}</p>
          <Button type="button" variant="outline" onClick={onSave} disabled={saving || saved} className="sm:shrink-0">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? tr('Saving…', 'Đang lưu…') : saved ? tr('Saved', 'Đã lưu') : tr('Save plan', 'Lưu kế hoạch')}
          </Button>
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
                <p className="mt-4 text-sm font-bold text-accent-foreground">{flight.priceLowVnd ? `${formatVnd(flight.priceLowVnd)}–${formatVnd(flight.priceHighVnd)}` : tr('No defensible fare found', 'Chưa tìm thấy mức giá đáng tin')}</p>
                <p className="mt-2 text-xs leading-relaxed text-body">{flight.fareNote}</p>
                {flight.url && <Button asChild variant="link" size="none" className="mt-4 h-auto justify-start p-0 text-xs font-bold"><a href={flight.url} target="_blank" rel="noreferrer">{tr('Check this option', 'Kiểm tra lựa chọn này')}<ExternalLink className="h-3.5 w-3.5" /></a></Button>}
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
              <p className="mt-3 text-xs font-bold text-accent-foreground">{formatVnd(stay.nightlyLowVnd)}–{formatVnd(stay.nightlyHighVnd)}{tr('/night', '/đêm')}</p>
              {stay.url && <Button asChild variant="link" size="none" className="mt-3 h-auto justify-start p-0 text-xs font-bold"><a href={stay.url} target="_blank" rel="noreferrer">{tr('View source', 'Xem nguồn')}<ExternalLink className="h-3.5 w-3.5" /></a></Button>}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="day-plan-title">
        <div className="mb-3 px-1"><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Your days', 'Lịch từng ngày')}</p><h2 id="day-plan-title" className="mt-1 text-xl font-bold text-foreground">{tr('Meticulous day-by-day plan', 'Kế hoạch chi tiết từng ngày')}</h2></div>
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
                <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs sm:flex-row sm:items-start sm:justify-between"><p className="flex max-w-2xl items-start gap-2 text-body"><UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />{day.foodNote}</p><p className="shrink-0 font-bold text-foreground">{tr('Day estimate', 'Ước tính ngày')}: {formatVnd(day.estimatedDailyCostVnd)}</p></div>
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

      <section aria-labelledby="sources-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1"><div><p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Trust, but verify', 'Tin cậy và kiểm chứng')}</p><h2 id="sources-title" className="mt-1 text-xl font-bold text-foreground">{tr('Web research sources', 'Nguồn nghiên cứu web')}</h2></div><Badge variant="brand" size="sm"><Globe2 className="h-3 w-3" />Google Search</Badge></div>
        <Card className="gap-0 divide-y divide-border/70 p-0">
          {result.sources.length ? result.sources.map((source, index) => (
            <Button key={`${source.url}-${index}`} asChild variant="bare" size="none" className="h-auto w-full justify-between gap-4 rounded-none px-4 py-3 text-left hover:bg-tint sm:px-5">
              <a href={source.url} target="_blank" rel="noreferrer"><span className="min-w-0"><span className="line-clamp-1 text-xs font-bold text-foreground">{source.title}</span><span className="mt-0.5 block text-2xs text-body">{source.domain}</span></span><ExternalLink className="h-4 w-4 shrink-0 text-ink-4" /></a>
            </Button>
          )) : <p className="px-5 py-4 text-xs text-body">{tr('Gemini returned no source links for this plan. Treat every option as unverified.', 'Gemini không trả về liên kết nguồn. Hãy xem mọi lựa chọn là chưa được xác minh.')}</p>}
        </Card>
      </section>

      {(plan.assumptions.length > 0 || result.searchQueries.length > 0) && (
        <Card className="gap-0 bg-accent p-4 text-accent-foreground">
          <p className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4" />{tr('Planning assumptions', 'Giả định khi lập kế hoạch')}</p>
          <ul className="mt-2 space-y-1.5 pl-5 text-xs leading-relaxed list-disc">{plan.assumptions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </Card>
      )}

      <p className="px-1 text-2xs leading-relaxed text-ink-4">{tr('AI research is a planning aid, not a booking engine. Flight seats, fares, hotel rooms, opening hours, visa rules, and weather can change. Confirm material details directly with the operator before paying.', 'Nghiên cứu AI hỗ trợ lập kế hoạch, không phải hệ thống đặt chỗ. Chỗ ngồi, giá vé, phòng, giờ mở cửa, quy định thị thực và thời tiết có thể thay đổi. Hãy xác nhận trực tiếp trước khi thanh toán.')}</p>
    </div>
  )
}

export function ItineraryBuilder() {
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
  const [cityIds, setCityIds] = useState<CityId[]>(['danang', 'hoian', 'hue'])
  const [cityToAdd, setCityToAdd] = useState<CityId>('hanoi')
  const [origin, setOrigin] = useState('')
  const [startDate, setStartDate] = useState('')
  const [days, setDays] = useState(8)
  const [travelers, setTravelers] = useState(2)
  const [budgetId, setBudgetId] = useState<BudgetId>('comfort')
  const [pace, setPace] = useState<PaceId>('balanced')
  const [interests, setInterests] = useState<Set<InterestId>>(() => new Set(['food', 'culture', 'nature']))
  const [accommodation, setAccommodation] = useState<AccommodationId>('boutique')
  const [includeFlights, setIncludeFlights] = useState(true)
  const [cabin, setCabin] = useState<CabinId>('economy')
  const [maxStops, setMaxStops] = useState<StopsId>('one_stop')
  const [checkedBags, setCheckedBags] = useState(true)
  const [notes, setNotes] = useState('')
  const [state, setState] = useState<'empty' | 'building' | 'ready' | 'error'>('empty')
  const [result, setResult] = useState<GeneratedItineraryResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const selectedCities = cityIds.map((id) => CITY_MAP.get(id)).filter((city) => Boolean(city))
  const availableCities = CITIES.filter((city) => !cityIds.includes(city.id))
  const endDate = addDays(startDate, days - 1)
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const budget = BUDGETS.find((item) => item.id === budgetId) || BUDGETS[1]

  const toggleInterest = (id: InterestId) => setInterests((current) => {
    const next = new Set(current)
    if (next.has(id) && next.size > 1) next.delete(id)
    else next.add(id)
    return next
  })

  const addCity = () => {
    if (cityIds.includes(cityToAdd) || cityIds.length >= 6) return
    const next = [...cityIds, cityToAdd]
    setCityIds(next)
    const replacement = CITIES.find((city) => !next.includes(city.id))
    if (replacement) setCityToAdd(replacement.id)
  }

  const removeCity = (id: CityId) => {
    if (cityIds.length === 1) return
    setCityIds((current) => current.filter((cityId) => cityId !== id))
    setCityToAdd(id)
  }

  const moveCity = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= cityIds.length) return
    setCityIds((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const buildPlan = async () => {
    if (!startDate) {
      toast.error(tr('Choose a departure date so we can research viable options.', 'Chọn ngày khởi hành để nghiên cứu lựa chọn phù hợp.'))
      return
    }
    if (includeFlights && origin.trim().length < 2) {
      toast.error(tr('Add your departure city or airport for flight research.', 'Thêm thành phố hoặc sân bay khởi hành để tìm chuyến bay.'))
      document.getElementById('trip-origin')?.focus()
      return
    }
    setState('building')
    setSavedId(null)
    try {
      const response = await forumApi<GeneratedItineraryResponse>('/api/itineraries/generate', {
        method: 'POST',
        auth: 'optional',
        body: JSON.stringify({
          locale: lang,
          origin: origin.trim(),
          startDate,
          days,
          travelers,
          cityIds,
          budgetId,
          pace,
          interests: Array.from(interests),
          accommodation,
          flight: { include: includeFlights, cabin, maxStops, checkedBags },
          notes: notes.trim(),
        }),
      })
      setResult(response)
      setState('ready')
      window.requestAnimationFrame(() => resultRef.current?.focus())
    } catch (error) {
      if (error instanceof ForumApiError && error.status === 401) {
        setState('empty')
        openSignIn()
        toast.message(tr('Sign in with your eno account to run live AI research.', 'Đăng nhập tài khoản eno để chạy nghiên cứu AI trực tiếp.'))
        return
      }
      setState('error')
      toast.error(error instanceof ForumApiError && error.status === 429
        ? tr('The planner has reached its research limit. Please try again later.', 'Trình lập kế hoạch đã đạt giới hạn nghiên cứu. Vui lòng thử lại sau.')
        : tr('Gemini could not complete this plan. Your inputs are still here—please retry.', 'Gemini chưa thể hoàn thành kế hoạch. Thông tin vẫn được giữ—hãy thử lại.'))
    }
  }

  const savePlan = async () => {
    if (!result) return
    if (!user) { openSignIn(); return }
    setSaving(true)
    const plan = result.plan
    try {
      const { itinerary } = await forumApi<{ itinerary: { id: string } }>('/api/itineraries', {
        method: 'POST',
        auth: 'required',
        body: JSON.stringify({
          title: plan.title,
          destinationId: cityIds[0],
          days,
          budgetId,
          interests: Array.from(interests),
          status: 'ready',
          estimatedBudget: plan.budget.groupHighVnd,
          currency: 'VND',
          generatedAt: result.generatedAt,
          dayPlans: plan.days.map((day) => ({
            dayNumber: day.dayNumber,
            area: day.city,
            areaVi: null,
            title: day.title,
            titleVi: null,
            morning: `${day.morning.time} · ${day.morning.title} — ${day.morning.details}`.slice(0, 1000),
            morningVi: null,
            afternoon: `${day.afternoon.time} · ${day.afternoon.title} — ${day.afternoon.details}`.slice(0, 1000),
            afternoonVi: null,
            evening: `${day.evening.time} · ${day.evening.title} — ${day.evening.details}`.slice(0, 1000),
            eveningVi: null,
          })),
          stays: plan.stays.map((stay, index) => ({
            position: index,
            name: stay.name,
            nameVi: null,
            area: `${stay.city} · ${stay.area}`.slice(0, 120),
            areaVi: null,
            note: stay.why,
            noteVi: null,
            estimatedNightly: stay.nightlyLowVnd,
            currency: 'VND',
          })),
        }),
      })
      setSavedId(itinerary.id)
      toast.success(tr('Itinerary saved to your eno account.', 'Lịch trình đã được lưu vào tài khoản eno.'))
    } catch {
      toast.error(tr('Your itinerary could not be saved.', 'Không thể lưu lịch trình của bạn.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl bg-brand-deep px-5 py-8 text-white sm:px-8 sm:py-10 lg:px-10">
        <div className="relative z-10 max-w-3xl">
          <Badge variant="brand" size="sm" className="bg-white/10 text-white"><SearchCheck className="h-3.5 w-3.5" />{tr('Grounded by live Google Search', 'Dựa trên Google Search trực tiếp')}</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{tr('A Vietnam itinerary that survives reality.', 'Lịch trình Việt Nam thực sự khả thi.')}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">{tr('Gemini 3.5 Flash researches viable flights, sensible transfers, current stays, and place-level details—then builds the trip around your dates, pace, and budget.', 'Gemini 3.5 Flash nghiên cứu chuyến bay phù hợp, di chuyển hợp lý, chỗ ở hiện tại và từng địa điểm—sau đó lập kế hoạch theo ngày, nhịp độ và ngân sách của bạn.')}</p>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/80 sm:text-sm">
            <span className="inline-flex items-center gap-2"><Plane className="h-4 w-4" />{tr('Flight research', 'Tìm chuyến bay')}</span>
            <span className="inline-flex items-center gap-2"><Route className="h-4 w-4" />{tr('Route optimization', 'Tối ưu lộ trình')}</span>
            <span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4" />{tr('Cited web sources', 'Nguồn web được trích dẫn')}</span>
          </div>
        </div>
        <Map className="pointer-events-none absolute -bottom-14 -right-10 h-64 w-64 rotate-6 text-white/5 sm:h-80 sm:w-80" aria-hidden="true" />
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[410px_minmax(0,1fr)]">
        <Card className="gap-0 overflow-visible p-5 sm:p-6 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><MapPinned className="h-5 w-5" /></span>
            <div><h2 className="text-lg font-bold text-foreground">{tr('Design the brief', 'Thiết kế yêu cầu')}</h2><p className="mt-1 text-xs leading-relaxed text-body">{tr('Specific inputs produce a plan you can actually use.', 'Thông tin cụ thể tạo ra kế hoạch thực sự hữu ích.')}</p></div>
          </div>

          <div className="mt-6 space-y-5">
            <FormSection icon={Route} title={tr('Route', 'Lộ trình')} subtitle={tr('Choose up to six stops in travel order.', 'Chọn tối đa sáu điểm theo thứ tự di chuyển.')}>
              <div className="space-y-2">
                {selectedCities.map((city, index) => city && (
                  <div key={city.id} className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{index + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-foreground">{tr(city.name, city.nameVi)}</span><span className="block text-2xs text-body">{city.airports.join(' / ')} · {tr(city.recommendedDays, city.recommendedDays)}</span></span>
                    <div className="flex shrink-0 items-center">
                      <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => moveCity(index, -1)} disabled={index === 0} aria-label={tr(`Move ${city.name} earlier`, `Đưa ${city.nameVi} lên trước`)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => moveCity(index, 1)} disabled={index === cityIds.length - 1} aria-label={tr(`Move ${city.name} later`, `Đưa ${city.nameVi} xuống sau`)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => removeCity(city.id)} disabled={cityIds.length === 1} aria-label={tr(`Remove ${city.name}`, `Xóa ${city.nameVi}`)}><X className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </div>
                ))}
              </div>
              {availableCities.length > 0 && cityIds.length < 6 && (
                <div className="mt-3 flex gap-2">
                  <Select value={cityToAdd} onValueChange={(value) => { if (typeof value === 'string') setCityToAdd(value as CityId) }}>
                    <SelectTrigger aria-label={tr('Add another Vietnam destination', 'Thêm điểm đến Việt Nam')} className="min-w-0 flex-1 cursor-pointer border-line-strong bg-card"><Plus className="h-4 w-4" /><SelectValue>{tr(CITY_MAP.get(cityToAdd)?.name || '', CITY_MAP.get(cityToAdd)?.nameVi || '')}</SelectValue></SelectTrigger>
                    <SelectContent align="start" className="max-h-80 min-w-[min(24rem,calc(100vw-2rem))]">
                      {availableCities.map((city) => <SelectItem key={city.id} value={city.id}><span className="flex flex-col items-start"><span className="font-semibold">{tr(city.name, city.nameVi)} · {city.airports.join('/')}</span><span className="text-xs text-body">{tr(city.description, city.descriptionVi)}</span></span></SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={addCity}>{tr('Add', 'Thêm')}</Button>
                </div>
              )}
            </FormSection>

            <FormSection icon={CalendarDays} title={tr('Dates and travelers', 'Ngày và số khách')} subtitle={tr('Exact dates make flight and seasonal research useful.', 'Ngày chính xác giúp tìm chuyến bay và mùa phù hợp.')}>
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel htmlFor="trip-start">{tr('Start date', 'Ngày bắt đầu')}</FieldLabel><Input id="trip-start" variant="outline" type="date" min={minDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} className="px-3" /></Field>
                <Field><FieldLabel>{tr('End date', 'Ngày kết thúc')}</FieldLabel><div className="flex h-[46px] items-center rounded-xl bg-tint px-3 text-sm font-semibold text-body">{endDate ? displayDate(endDate, lang) : tr('Choose start', 'Chọn ngày đầu')}</div></Field>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><p id="trip-days-label" className="text-sm font-medium text-foreground">{tr('Trip length', 'Thời lượng')}</p><Badge variant="brand" size="md">{days} {tr('days', 'ngày')}</Badge></div>
                <Slider value={days} min={3} max={21} onChange={setDays} aria-label={tr('Trip length in days', 'Số ngày của chuyến đi')} className="mt-3" />
                <div className="mt-1 flex justify-between text-2xs text-ink-4"><span>3</span><span>21</span></div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><p id="travelers-label" className="text-sm font-medium text-foreground">{tr('Travelers', 'Số khách')}</p><Badge variant="neutral" size="md"><Users className="h-3.5 w-3.5" />{travelers}</Badge></div>
                <Slider value={travelers} min={1} max={8} onChange={setTravelers} aria-label={tr('Number of travelers', 'Số khách đi cùng')} className="mt-3" />
              </div>
            </FormSection>

            <FormSection icon={Plane} title={tr('Flight research', 'Tìm chuyến bay')} subtitle={tr('Gemini searches viable route patterns and fare signals—not reserved inventory.', 'Gemini tìm đường bay và tín hiệu giá—không phải chỗ đã giữ.')}>
              <Button type="button" variant="bare" size="none" aria-pressed={includeFlights} onClick={() => setIncludeFlights((value) => !value)} className={cn('h-auto w-full justify-start gap-3 rounded-xl border px-3 py-3 text-left', includeFlights ? 'border-brand bg-accent' : 'border-border bg-card')}>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-md border', includeFlights ? 'border-brand bg-primary text-white' : 'border-line-strong')}>{includeFlights && <Check className="h-3 w-3" />}</span>
                <span><span className="block text-sm font-bold text-foreground">{tr('Include flight options', 'Bao gồm lựa chọn chuyến bay')}</span><span className="mt-0.5 block text-xs text-body">{tr('International gateway and useful domestic legs', 'Cửa ngõ quốc tế và chặng nội địa hữu ích')}</span></span>
              </Button>
              {includeFlights && (
                <div className="mt-4 space-y-4">
                  <Field><FieldLabel htmlFor="trip-origin">{tr('Flying from', 'Bay từ')}</FieldLabel><Input id="trip-origin" variant="outline" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder={tr('City or airport, e.g. Singapore (SIN)', 'Thành phố hoặc sân bay, ví dụ Singapore (SIN)')} /><FieldDescription>{tr('Add an airport code when you know it.', 'Thêm mã sân bay nếu bạn biết.')}</FieldDescription></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field><FieldLabel id="cabin-label">{tr('Cabin', 'Hạng ghế')}</FieldLabel><Select value={cabin} onValueChange={(value) => { if (typeof value === 'string') setCabin(value as CabinId) }}><SelectTrigger aria-labelledby="cabin-label" className="w-full cursor-pointer border-line-strong bg-card"><SelectValue>{cabin === 'premium_economy' ? tr('Premium economy', 'Phổ thông đặc biệt') : cabin === 'business' ? tr('Business', 'Thương gia') : tr('Economy', 'Phổ thông')}</SelectValue></SelectTrigger><SelectContent><SelectItem value="economy">{tr('Economy', 'Phổ thông')}</SelectItem><SelectItem value="premium_economy">{tr('Premium economy', 'Phổ thông đặc biệt')}</SelectItem><SelectItem value="business">{tr('Business', 'Thương gia')}</SelectItem></SelectContent></Select></Field>
                    <Field><FieldLabel id="stops-label">{tr('Stops', 'Điểm dừng')}</FieldLabel><Select value={maxStops} onValueChange={(value) => { if (typeof value === 'string') setMaxStops(value as StopsId) }}><SelectTrigger aria-labelledby="stops-label" className="w-full cursor-pointer border-line-strong bg-card"><SelectValue>{maxStops === 'direct' ? tr('Direct only', 'Chỉ bay thẳng') : maxStops === 'one_stop' ? tr('Up to 1 stop', 'Tối đa 1 điểm') : tr('Any viable', 'Mọi lựa chọn')}</SelectValue></SelectTrigger><SelectContent><SelectItem value="direct">{tr('Direct only', 'Chỉ bay thẳng')}</SelectItem><SelectItem value="one_stop">{tr('Up to 1 stop', 'Tối đa 1 điểm')}</SelectItem><SelectItem value="any">{tr('Any viable', 'Mọi lựa chọn')}</SelectItem></SelectContent></Select></Field>
                  </div>
                  <Button type="button" variant="bare" size="none" aria-pressed={checkedBags} onClick={() => setCheckedBags((value) => !value)} className={cn('h-auto gap-2 rounded-full border px-3 py-2 text-xs font-semibold', checkedBags ? 'border-brand bg-primary text-white' : 'border-border text-body')}><Luggage className="h-3.5 w-3.5" />{tr('Checked baggage needed', 'Cần hành lý ký gửi')}</Button>
                </div>
              )}
            </FormSection>

            <FormSection icon={WalletCards} title={tr('Comfort and budget', 'Tiện nghi và ngân sách')}>
              <RadioGroup value={budgetId} onValueChange={(value) => setBudgetId(value as BudgetId)} aria-label={tr('Budget per traveler', 'Ngân sách mỗi khách')} className="grid gap-2">
                {BUDGETS.map((item) => <Radio key={item.id} value={item.id} className={cn('w-full justify-start rounded-xl border px-3 py-3 text-left', budgetId === item.id ? 'border-brand bg-accent' : 'border-border bg-card hover:bg-tint')}><RadioDot /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-foreground">{tr(item.label, item.labelVi)}</span><span className="block text-xs text-body">{tr(item.detail, item.detailVi)}</span></span></Radio>)}
              </RadioGroup>
              <Field className="mt-4"><FieldLabel id="stay-style-label">{tr('Stay style', 'Kiểu lưu trú')}</FieldLabel><Select value={accommodation} onValueChange={(value) => { if (typeof value === 'string') setAccommodation(value as AccommodationId) }}><SelectTrigger aria-labelledby="stay-style-label" className="w-full cursor-pointer border-line-strong bg-card"><Building2 className="h-4 w-4" /><SelectValue>{tr(ACCOMMODATIONS.find((item) => item.id === accommodation)?.label || '', ACCOMMODATIONS.find((item) => item.id === accommodation)?.labelVi || '')}</SelectValue></SelectTrigger><SelectContent>{ACCOMMODATIONS.map((item) => <SelectItem key={item.id} value={item.id}>{tr(item.label, item.labelVi)}</SelectItem>)}</SelectContent></Select></Field>
            </FormSection>

            <FormSection icon={Compass} title={tr('Pace and interests', 'Nhịp độ và sở thích')}>
              <RadioGroup value={pace} onValueChange={(value) => setPace(value as PaceId)} aria-label={tr('Trip pace', 'Nhịp độ chuyến đi')} className="grid gap-2 sm:grid-cols-3">
                {PACES.map((item) => <Radio key={item.id} value={item.id} className={cn('min-w-0 w-full justify-start whitespace-normal rounded-xl border px-3 py-3 text-left sm:flex-col sm:justify-center sm:px-2 sm:text-center', pace === item.id ? 'border-brand bg-accent' : 'border-border bg-card hover:bg-tint')}><span className="text-xs font-bold text-foreground">{tr(item.label, item.labelVi)}</span><span className="mt-1 w-full break-words text-3xs leading-snug text-body">{tr(item.detail, item.detailVi)}</span></Radio>)}
              </RadioGroup>
              <div role="group" aria-label={tr('Trip interests', 'Sở thích chuyến đi')} className="mt-4 flex flex-wrap gap-2">
                {INTERESTS.map(({ id, label, labelVi, Icon }) => <Button key={id} type="button" variant="bare" size="none" aria-pressed={interests.has(id)} onClick={() => toggleInterest(id)} className={cn('gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold', interests.has(id) ? 'border-brand bg-primary text-white' : 'border-border text-body hover:bg-tint')}><Icon className="h-3.5 w-3.5" />{tr(label, labelVi)}</Button>)}
              </div>
            </FormSection>

            <FormSection icon={Info} title={tr('Anything we should know?', 'Điều gì cần lưu ý?')} subtitle={tr('Diet, mobility, children, celebrations, work calls, or hard no’s.', 'Ăn kiêng, di chuyển, trẻ em, dịp đặc biệt, công việc hoặc điều không muốn.')}>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={600} rows={3} size="compact" variant="outline" placeholder={tr('Example: vegetarian, avoid early mornings, one traveler has limited mobility…', 'Ví dụ: ăn chay, tránh sáng sớm, một khách hạn chế vận động…')} />
              <p className="mt-1 text-right text-2xs tabular-nums text-ink-4">{notes.length}/600</p>
            </FormSection>
          </div>

          <Button data-testid="build-itinerary" type="button" variant="cta" size="lg" className="mt-6 w-full" onClick={() => void buildPlan()} disabled={state === 'building'}>
            {state === 'building' ? <Loader2 className="h-4 w-4 animate-spin" /> : result ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {state === 'building' ? tr('Researching the trip…', 'Đang nghiên cứu chuyến đi…') : result ? tr('Research a new version', 'Nghiên cứu phiên bản mới') : tr('Research and build itinerary', 'Nghiên cứu và tạo lịch trình')}
          </Button>
          <p className="mt-3 text-center text-2xs leading-relaxed text-ink-4">{user ? tr('Includes live web research. Up to 8 plans per account each hour.', 'Bao gồm nghiên cứu web trực tiếp. Tối đa 8 kế hoạch mỗi giờ.') : tr('A unified eno account is required before paid web research runs.', 'Cần tài khoản eno thống nhất trước khi chạy nghiên cứu web trả phí.')}</p>
        </Card>

        <section aria-label={tr('Itinerary result', 'Kết quả lịch trình')}>
          {state === 'empty' && (
            <Card className="min-h-[620px] items-center justify-center gap-0 px-5 py-12 text-center sm:px-10">
              <span className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-accent-foreground"><Map className="h-9 w-9" /><SearchCheck className="absolute -right-2 -top-2 h-6 w-6 text-brand" /></span>
              <h2 className="mt-6 text-2xl font-bold text-foreground">{tr('From vague idea to researched plan', 'Từ ý tưởng đến kế hoạch đã nghiên cứu')}</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-body">{tr('Set your exact route, dates, flight constraints, pace, and preferences. The planner will search before it recommends.', 'Chọn lộ trình, ngày, yêu cầu chuyến bay, nhịp độ và sở thích. Trình lập kế hoạch sẽ tìm kiếm trước khi gợi ý.')}</p>
              <div className="mt-8 grid w-full max-w-xl gap-3 sm:grid-cols-3">
                {[{ Icon: Plane, label: tr('Viable flight leads', 'Gợi ý chuyến bay') }, { Icon: Hotel, label: tr('Real stay candidates', 'Chỗ ở thực tế') }, { Icon: CalendarCheck, label: tr('Book-by timeline', 'Mốc thời gian đặt') }].map(({ Icon, label }) => <div key={label} className="flex items-center justify-center gap-2 rounded-xl bg-tint px-3 py-3 text-xs font-semibold text-body sm:flex-col"><Icon className="h-5 w-5 text-accent-foreground" />{label}</div>)}
              </div>
            </Card>
          )}
          {state === 'building' && <PlannerLoading />}
          {state === 'error' && (
            <Card className="min-h-[420px] items-center justify-center gap-0 px-6 py-12 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><Info className="h-6 w-6" /></span><h2 className="mt-5 text-xl font-bold text-foreground">{tr('The research run did not finish', 'Lần nghiên cứu chưa hoàn tất')}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-body">{tr('Nothing was lost. Review the brief and retry in a moment.', 'Không mất dữ liệu. Hãy xem lại yêu cầu và thử lại sau ít phút.')}</p><Button type="button" variant="outline" className="mt-5" onClick={() => void buildPlan()}><RefreshCw className="h-4 w-4" />{tr('Retry research', 'Thử lại nghiên cứu')}</Button></Card>
          )}
          {state === 'ready' && result && <div ref={resultRef} tabIndex={-1} className="outline-none"><PlanResults result={result} travelers={travelers} days={days} onSave={() => void savePlan()} saving={saving} saved={Boolean(savedId)} /></div>}
        </section>
      </div>
    </main>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Building2,
  BusFront,
  CalendarCheck,
  CalendarDays,
  CarFront,
  Check,
  CircleDollarSign,
  Clock3,
  CloudSun,
  Compass,
  ConciergeBell,
  Download,
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
  MessagesSquare,
  MoonStar,
  Navigation,
  Plane,
  PhoneCall,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  SearchCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Stamp,
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
import { requestTranslations, useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
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
import { localeForLanguage, type Language } from '@/lib/languages'
import { buildItinerarySavePayload } from '@/lib/itinerary-save'
import { itineraryDocxTranslationSources } from '@/lib/itinerary-docx-copy'
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
  type City,
  type CityId,
  type GeneratedItineraryResponse,
  type GeneratedPlan,
  type InterestId,
  type PaceId,
  type StopsId,
} from './itinerary-data'
import { buildItineraryResourceGroups, type ItineraryResourceKind } from './itinerary-resources'

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

const MIN_TRIP_DAYS = 1
const MAX_TRIP_DAYS = 30
const MAX_ROUTE_CITIES = 15
const MAX_TRAVELER_SLIDER = 10
const MAX_TRAVELERS = 100

const CITY_GROUPS = [
  { id: 'north', label: 'Northern Vietnam', labelVi: 'Miền Bắc', items: CITIES.filter((city) => city.region === 'north') },
  { id: 'central', label: 'Central Vietnam', labelVi: 'Miền Trung', items: CITIES.filter((city) => city.region === 'central') },
  { id: 'south', label: 'Southern Vietnam', labelVi: 'Miền Nam', items: CITIES.filter((city) => city.region === 'south') },
] as const

const AIRPORT_GROUPS = [
  {
    id: 'asia', label: 'Popular Asia gateways', labelVi: 'Cửa ngõ phổ biến ở châu Á', items: [
      'Bangkok (BKK)', 'Singapore (SIN)', 'Kuala Lumpur (KUL)', 'Seoul (ICN)', 'Tokyo (NRT)',
      'Hong Kong (HKG)', 'Taipei (TPE)', 'Phnom Penh (PNH)', 'Siem Reap (SAI)', 'Delhi (DEL)',
    ],
  },
  {
    id: 'long-haul', label: 'Popular long-haul gateways', labelVi: 'Cửa ngõ đường dài phổ biến', items: [
      'Dubai (DXB)', 'Doha (DOH)', 'Sydney (SYD)', 'Melbourne (MEL)', 'London (LHR)', 'Paris (CDG)',
      'Frankfurt (FRA)', 'Istanbul (IST)', 'Los Angeles (LAX)', 'San Francisco (SFO)', 'New York (JFK)',
      'Toronto (YYZ)', 'Vancouver (YVR)',
    ],
  },
] as const

type CityGroup = { id: string; label: string; labelVi: string; items: City[] }
type AirportGroup = { id: string; label: string; labelVi: string; items: readonly string[] }

function clampWholeNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function cityMatchesSearch(city: City, query: string) {
  const searchable = [city.name, city.nameVi, city.regionLabel, city.regionLabelVi, city.description, city.descriptionVi, ...city.airports].join(' ')
  return normalizeSearch(searchable).includes(normalizeSearch(query.trim()))
}

function recommendedDayRange(city: City) {
  const values = city.recommendedDays.match(/\d+/g)?.map(Number) || [3]
  return { min: values[0] || 3, max: values[1] || values[0] || 3 }
}

function suggestedDaysForRoute(cityIds: CityId[]) {
  const cities = cityIds.map((id) => CITY_MAP.get(id)).filter((city): city is City => Boolean(city))
  if (cities.length === 0) return 4
  if (cities.length === 1) return recommendedDayRange(cities[0]).max
  return clampWholeNumber(cities.reduce((total, city) => {
    const range = recommendedDayRange(city)
    return total + Math.ceil((range.min + range.max) / 2)
  }, 0), MIN_TRIP_DAYS, MAX_TRIP_DAYS)
}

function dateInputValueFromToday(offsetDays: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayDate(date: string, locale: Language) {
  if (!date) return '—'
  return new Intl.DateTimeFormat(localeForLanguage(locale), {
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
  const { lang } = useLanguage()
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
        {activity.estimatedCostVnd > 0 && <Badge variant="neutral" size="sm"><CircleDollarSign className="h-3 w-3" />{formatVnd(activity.estimatedCostVnd, lang)}</Badge>}
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
        : await requestTranslations(itineraryDocxTranslationSources(result), lang)
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
            [tr('Per traveler', 'Mỗi khách'), `${formatVnd(plan.budget.perTravelerLowVnd, lang)}–${formatVnd(plan.budget.perTravelerHighVnd, lang)}`],
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
                <p className="mt-4 text-sm font-bold text-accent-foreground">{flight.priceLowVnd ? `${formatVnd(flight.priceLowVnd, lang)}–${formatVnd(flight.priceHighVnd, lang)}` : tr('No defensible fare found', 'Chưa tìm thấy mức giá đáng tin')}</p>
                <p className="mt-2 text-xs leading-relaxed text-body">{flight.fareNote}</p>
                {flight.url && <a href={flight.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'link', size: 'none', className: 'mt-4 h-auto justify-start p-0 text-xs font-bold' })}>{tr('Check this option', 'Kiểm tra lựa chọn này')}<ExternalLink className="h-3.5 w-3.5" /></a>}
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
              <p className="mt-3 text-xs font-bold text-accent-foreground">{formatVnd(stay.nightlyLowVnd, lang)}–{formatVnd(stay.nightlyHighVnd, lang)}{tr('/night', '/đêm')}</p>
              {stay.url && <a href={stay.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'link', size: 'none', className: 'mt-3 h-auto justify-start p-0 text-xs font-bold' })}>{tr('View source', 'Xem nguồn')}<ExternalLink className="h-3.5 w-3.5" /></a>}
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
                <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs sm:flex-row sm:items-start sm:justify-between"><p className="flex max-w-2xl items-start gap-2 text-body"><UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />{day.foodNote}</p><p className="shrink-0 font-bold text-foreground">{tr('Day estimate', 'Ước tính ngày')}: {formatVnd(day.estimatedDailyCostVnd, lang)}</p></div>
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

export function ItineraryBuilder() {
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
  const [hydrated, setHydrated] = useState(false)
  const [cityIds, setCityIds] = useState<CityId[]>(['danang'])
  const [cityDays, setCityDays] = useState<Partial<Record<CityId, number>>>({})
  const [citySearch, setCitySearch] = useState('')
  const [origin, setOrigin] = useState('')
  const [startDate, setStartDate] = useState('')
  const [days, setDays] = useState(4)
  const [travelers, setTravelers] = useState(2)
  const [budgetId, setBudgetId] = useState<BudgetId>('comfort')
  const [pace, setPace] = useState<PaceId>('balanced')
  const [interests, setInterests] = useState<Set<InterestId>>(() => new Set(['food', 'culture', 'nature']))
  const [accommodation, setAccommodation] = useState<AccommodationId>('hotel')
  const [includeFlights, setIncludeFlights] = useState(false)
  const [cabin, setCabin] = useState<CabinId>('economy')
  const [maxStops, setMaxStops] = useState<StopsId>('one_stop')
  const [checkedBags, setCheckedBags] = useState(true)
  const [notes, setNotes] = useState('')
  const [state, setState] = useState<'empty' | 'building' | 'ready' | 'error'>('empty')
  const [result, setResult] = useState<GeneratedItineraryResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  // Tracks the result a persistPlan call belongs to, so a slow auto-save for a
  // superseded plan can never stamp its savedId onto a newer plan (sendEpoch pattern).
  const resultDataRef = useRef<GeneratedItineraryResponse | null>(null)
  const daysCustomizedRef = useRef(false)

  useEffect(() => setHydrated(true), [])

  const selectedCities = cityIds.map((id) => CITY_MAP.get(id)).filter((city) => Boolean(city))
  const primaryCity = CITY_MAP.get(cityIds[0]) || CITIES[0]
  const allocatedCityDays = cityIds.reduce((total, id) => total + (cityDays[id] || 0), 0)
  const allCityDaysSet = cityIds.every((id) => cityDays[id] != null)
  const flexibleCityCount = cityIds.filter((id) => cityDays[id] == null).length
  const availableCityGroups = useMemo<CityGroup[]>(() => CITY_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((city) => !cityIds.includes(city.id)),
  })).filter((group) => group.items.length > 0), [cityIds])
  const endDate = addDays(startDate, days - 1)
  const minDate = useMemo(() => dateInputValueFromToday(0), [])
  const budget = BUDGETS.find((item) => item.id === budgetId) || BUDGETS[1]

  useEffect(() => {
    if (!allCityDaysSet) return
    const total = cityIds.reduce((sum, id) => sum + (cityDays[id] || 0), 0)
    if (total < MIN_TRIP_DAYS || total > MAX_TRIP_DAYS) return
    daysCustomizedRef.current = true
    setDays(total)
  }, [allCityDaysSet, cityDays, cityIds])

  const toggleInterest = (id: InterestId) => setInterests((current) => {
    const next = new Set(current)
    if (next.has(id) && next.size > 1) next.delete(id)
    else next.add(id)
    return next
  })

  const updateSuggestedDays = (nextCityIds: CityId[]) => {
    if (!daysCustomizedRef.current) setDays(suggestedDaysForRoute(nextCityIds))
  }

  const choosePrimaryCity = (city: City | null) => {
    if (!city) return
    const existingIndex = cityIds.indexOf(city.id)
    const previousPrimary = cityIds[0]
    const next = [...cityIds]
    if (existingIndex > 0) {
      ;[next[0], next[existingIndex]] = [next[existingIndex], next[0]]
    } else {
      next[0] = city.id
      if (previousPrimary !== city.id) {
        setCityDays((current) => {
          const updated = { ...current }
          delete updated[previousPrimary]
          return updated
        })
      }
    }
    setCityIds(next)
    updateSuggestedDays(next)
  }

  const addCity = (city: City | null) => {
    if (!city || cityIds.includes(city.id) || cityIds.length >= MAX_ROUTE_CITIES) return
    const next = [...cityIds, city.id]
    setCityIds(next)
    setCitySearch('')
    updateSuggestedDays(next)
  }

  const removeCity = (id: CityId) => {
    if (cityIds.length === 1) return
    const next = cityIds.filter((cityId) => cityId !== id)
    setCityIds(next)
    setCityDays((current) => {
      const updated = { ...current }
      delete updated[id]
      return updated
    })
    updateSuggestedDays(next)
  }

  const updateCityDays = (id: CityId, value: string) => {
    if (value === '') {
      setCityDays((current) => {
        const updated = { ...current }
        delete updated[id]
        return updated
      })
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setCityDays((current) => ({
      ...current,
      [id]: clampWholeNumber(parsed, 1, MAX_TRIP_DAYS),
    }))
  }

  const moveCity = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= cityIds.length) return
    setCityIds((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      updateSuggestedDays(next)
      return next
    })
  }

  const buildPlan = async () => {
    if (!startDate) {
      toast.error(tr('Choose a departure date so we can research viable options.', 'Chọn ngày khởi hành để nghiên cứu lựa chọn phù hợp.'))
      document.getElementById('trip-start')?.focus()
      return
    }
    if (includeFlights && origin.trim().length < 2) {
      toast.error(tr('Add your departure city or airport for flight research.', 'Thêm thành phố hoặc sân bay khởi hành để tìm chuyến bay.'))
      document.getElementById('trip-origin')?.focus()
      return
    }
    if (allocatedCityDays + flexibleCityCount > days) {
      toast.error(tr(
        'Destination days need room inside the total trip length. Increase the total below or lower an entered city value.',
        'Số ngày tại các điểm đến cần nằm trong tổng thời lượng chuyến đi. Hãy tăng tổng số ngày bên dưới hoặc giảm số ngày đã nhập.',
      ))
      const firstAllocatedCity = cityIds.find((id) => cityDays[id] != null)
      document.getElementById(`city-days-${firstAllocatedCity || cityIds[0]}`)?.focus()
      return
    }
    setState('building')
    setSavedId(null)
    // Invalidate any in-flight auto-save immediately: a stale persistPlan that
    // resolves while we are building must not stamp savedId onto the next plan.
    resultDataRef.current = null
    try {
      const response = await forumApi<GeneratedItineraryResponse>('/api/itineraries/generate', {
        method: 'POST',
        auth: 'optional',
        direct: true,
        body: JSON.stringify({
          locale: lang,
          origin: origin.trim(),
          startDate,
          days,
          travelers,
          cityIds,
          cityDays: cityIds.flatMap((cityId) => cityDays[cityId] == null
            ? []
            : [{ cityId, days: cityDays[cityId] as number }]),
          budgetId,
          pace,
          interests: Array.from(interests),
          accommodation,
          flight: { include: includeFlights, cabin, maxStops, checkedBags },
          notes: notes.trim(),
        }),
      })
      setResult(response)
      resultDataRef.current = response
      setState('ready')
      window.requestAnimationFrame(() => resultRef.current?.focus())
      if (user) void persistPlan(response, true)
    } catch (error) {
      if (error instanceof ForumApiError && error.status === 401) {
        setState('empty')
        openSignIn()
        toast.message(tr('Sign in with your eno account to run live travel research.', 'Đăng nhập tài khoản eno để nghiên cứu chuyến đi trực tiếp.'))
        return
      }
      setState('error')
      toast.error(error instanceof ForumApiError && error.status === 429
        ? tr('The planner has reached its research limit. Please try again later.', 'Trình lập kế hoạch đã đạt giới hạn nghiên cứu. Vui lòng thử lại sau.')
        : tr('eno could not complete this plan. Your inputs are still here—please retry.', 'eno chưa thể hoàn thành kế hoạch. Thông tin vẫn được giữ—hãy thử lại.'))
    }
  }

  const persistPlan = async (nextResult: GeneratedItineraryResponse, announce: boolean) => {
    if (!user) return null
    setSaving(true)
    try {
      const { itinerary } = await forumApi<{ itinerary: { id: string } }>('/api/itineraries', {
        method: 'POST',
        auth: 'required',
        body: JSON.stringify(buildItinerarySavePayload({ result: nextResult, cityIds, days, budgetId, interests })),
      })
      if (resultDataRef.current === nextResult) setSavedId(itinerary.id)
      if (announce) toast.success(tr('Itinerary saved automatically to your eno dashboard.', 'Lịch trình đã tự động lưu vào bảng điều khiển eno.'))
      return itinerary.id
    } catch {
      toast.error(tr('Your itinerary could not be saved.', 'Không thể lưu lịch trình của bạn.'))
      return null
    } finally {
      setSaving(false)
    }
  }

  const savePlan = async () => {
    if (!result) return
    if (!user) { openSignIn(); return }
    await persistPlan(result, true)
  }

  return (
    <main id="main" tabIndex={-1} data-hydrated={hydrated} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <div className="grid items-start gap-6 lg:grid-cols-[410px_minmax(0,1fr)] lg:grid-rows-[max-content_1fr]">
        {state !== 'ready' && <section className="relative overflow-hidden rounded-3xl bg-brand-deep px-5 py-8 text-white sm:px-8 sm:py-10 lg:col-start-2 lg:row-start-1 lg:px-10">
          <div className="relative z-10 max-w-3xl">
            <Badge variant="brand" size="sm" className="bg-white/10 text-white"><SearchCheck className="h-3.5 w-3.5" />{tr('Current travel research', 'Nghiên cứu du lịch hiện tại')}</Badge>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{tr('A Vietnam itinerary that survives reality.', 'Lịch trình Việt Nam thực sự khả thi.')}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">{tr('eno checks practical flights, transfers, stays, and local details, then shapes the trip around your dates, pace, and budget.', 'eno kiểm tra chuyến bay, di chuyển, chỗ ở và thông tin địa phương, sau đó lập kế hoạch theo ngày, nhịp độ và ngân sách của bạn.')}</p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/80 sm:text-sm">
              <span className="inline-flex items-center gap-2"><Plane className="h-4 w-4" />{tr('Flight research', 'Tìm chuyến bay')}</span>
              <span className="inline-flex items-center gap-2"><Route className="h-4 w-4" />{tr('Route optimization', 'Tối ưu lộ trình')}</span>
              <span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4" />{tr('Cited web sources', 'Nguồn web được trích dẫn')}</span>
            </div>
          </div>
          <Map className="pointer-events-none absolute -bottom-14 -right-10 h-64 w-64 rotate-6 text-white/5 sm:h-80 sm:w-80" aria-hidden="true" />
        </section>}

        <Card className="gap-0 overflow-visible p-5 sm:p-6 lg:sticky lg:top-24 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Route className="h-5 w-5" /></span>
            <div><h2 className="text-lg font-bold text-foreground">{tr('Design the route', 'Thiết kế lộ trình')}</h2><p className="mt-1 text-xs leading-relaxed text-body">{tr('Start with one destination. Add stops only when useful.', 'Bắt đầu với một điểm đến. Chỉ thêm điểm dừng khi cần.')}</p></div>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void buildPlan() }}>
            <div className="mt-4 space-y-5">
            <div>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-2">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="primary-destination">{tr('Main destination', 'Điểm đến chính')}</FieldLabel>
                  <Combobox
                    items={CITY_GROUPS}
                    value={primaryCity}
                    onValueChange={choosePrimaryCity}
                    itemToStringLabel={(city: City) => tr(city.name, city.nameVi)}
                    itemToStringValue={(city: City) => city.id}
                    filter={cityMatchesSearch}
                    autoHighlight
                  >
                    <ComboboxInputGroup>
                      <span className="ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-bold text-white">1</span>
                      <ComboboxInput id="primary-destination" autoComplete="off" className="px-2" />
                      <ComboboxTrigger aria-label={tr('Search destinations', 'Tìm điểm đến')} />
                    </ComboboxInputGroup>
                    <ComboboxContent>
                      <ComboboxEmpty>{tr('No matching destination.', 'Không có điểm đến phù hợp.')}</ComboboxEmpty>
                      <ComboboxList>
                        {(group: CityGroup) => (
                          <ComboboxGroup key={group.id} items={group.items}>
                            <ComboboxGroupLabel>{tr(group.label, group.labelVi)}</ComboboxGroupLabel>
                            {group.items.map((city) => (
                              <ComboboxItem key={city.id} value={city}>
                                <span className="flex flex-col items-start">
                                  <span className="font-semibold text-foreground">{tr(city.name, city.nameVi)} · {city.airports.join('/')}</span>
                                  <span className="text-xs text-body">{tr(city.description, city.descriptionVi)}</span>
                                </span>
                              </ComboboxItem>
                            ))}
                          </ComboboxGroup>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>{tr('Type a city, region, or airport code.', 'Nhập thành phố, khu vực hoặc mã sân bay.')}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`city-days-${primaryCity.id}`}>{tr('Days', 'Số ngày')}</FieldLabel>
                  <Input
                    id={`city-days-${primaryCity.id}`}
                    aria-label={tr(`Days in ${primaryCity.name}`, `Số ngày ở ${primaryCity.nameVi}`)}
                    variant="outline"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_TRIP_DAYS}
                    value={cityDays[primaryCity.id] ?? ''}
                    placeholder={tr('Auto', 'Tự động')}
                    onChange={(event) => updateCityDays(primaryCity.id, event.currentTarget.value)}
                    className="h-11 px-2 py-0 text-center font-bold tabular-nums"
                  />
                  <FieldDescription>{tr('Optional', 'Tùy chọn')}</FieldDescription>
                </Field>
              </div>

              {selectedCities.length > 1 && (
                <div className="mt-3 space-y-2" aria-label={tr('Additional route stops', 'Điểm dừng bổ sung')}>
                  {selectedCities.slice(1).map((city, offset) => city && (
                    <div key={city.id} data-testid="itinerary-route-stop" className="flex min-h-14 items-center gap-2 rounded-xl bg-tint px-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{offset + 2}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-foreground">{tr(city.name, city.nameVi)}</span><span className="block text-2xs text-body">{city.airports.join(' / ')} · {city.recommendedDays}</span></span>
                      <label className="flex w-16 shrink-0 flex-col gap-1 text-3xs font-semibold text-body">
                        <span className="text-center">{tr('Days', 'Số ngày')}</span>
                        <Input
                          id={`city-days-${city.id}`}
                          aria-label={tr(`Days in ${city.name}`, `Số ngày ở ${city.nameVi}`)}
                          variant="outline"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_TRIP_DAYS}
                          value={cityDays[city.id] ?? ''}
                          placeholder={tr('Auto', 'Tự động')}
                          onChange={(event) => updateCityDays(city.id, event.currentTarget.value)}
                          className="h-8 w-16 px-1 py-0 text-center text-xs font-bold tabular-nums"
                        />
                      </label>
                      <div className="flex shrink-0 items-center">
                        <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => moveCity(offset + 1, -1)} aria-label={tr(`Move ${city.name} earlier`, `Đưa ${city.nameVi} lên trước`)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                        <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => moveCity(offset + 1, 1)} disabled={offset + 1 === cityIds.length - 1} aria-label={tr(`Move ${city.name} later`, `Đưa ${city.nameVi} xuống sau`)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                        <IconButton size="xs" tapTarget={false} className="text-body hover:bg-muted" onClick={() => removeCity(city.id)} aria-label={tr(`Remove ${city.name}`, `Xóa ${city.nameVi}`)}><X className="h-3.5 w-3.5" /></IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 text-xs leading-relaxed text-body">
                {tr(
                  'Optional: enter days for each destination. Leave any box empty if you are unsure, then choose the total trip length below and eno will distribute the remaining days.',
                  'Tùy chọn: nhập số ngày cho từng điểm đến. Nếu chưa chắc, hãy để trống và chọn tổng thời lượng chuyến đi bên dưới; eno sẽ phân bổ số ngày còn lại.',
                )}
                {allocatedCityDays > 0 && (
                  <span className={cn('mt-1 block font-semibold', allocatedCityDays + flexibleCityCount > days ? 'text-destructive' : 'text-foreground')}>
                    {tr(`${allocatedCityDays} of ${days} total days assigned.`, `Đã phân bổ ${allocatedCityDays} trong tổng số ${days} ngày.`)}
                    {allCityDaysSet && allocatedCityDays <= MAX_TRIP_DAYS
                      ? ` ${tr('The total trip length updates automatically.', 'Tổng thời lượng được cập nhật tự động.')}`
                      : ''}
                  </span>
                )}
              </p>

              {availableCityGroups.length > 0 && cityIds.length < MAX_ROUTE_CITIES && (
                <Field className="mt-3">
                  <FieldLabel htmlFor="add-destination">{tr('Add another stop', 'Thêm điểm dừng')} <span className="font-normal text-ink-4">{tr('(optional)', '(không bắt buộc)')}</span></FieldLabel>
                  <Combobox
                    key={cityIds.join('-')}
                    items={availableCityGroups}
                    value={null}
                    inputValue={citySearch}
                    onInputValueChange={setCitySearch}
                    onValueChange={addCity}
                    itemToStringLabel={(city: City) => tr(city.name, city.nameVi)}
                    itemToStringValue={(city: City) => city.id}
                    filter={cityMatchesSearch}
                    autoHighlight
                  >
                    <ComboboxInputGroup>
                      {citySearch ? <Search className="ml-3 h-4 w-4 shrink-0 text-ink-4" /> : <Plus className="ml-3 h-4 w-4 shrink-0 text-ink-4" />}
                      <ComboboxInput id="add-destination" autoComplete="off" className="px-2" placeholder={tr('Search city, region, or airport code', 'Tìm thành phố, khu vực hoặc mã sân bay')} />
                      <ComboboxClear aria-label={tr('Clear destination search', 'Xóa tìm kiếm điểm đến')} />
                      <ComboboxTrigger aria-label={tr('Show available destinations', 'Hiện các điểm đến')} />
                    </ComboboxInputGroup>
                    <ComboboxContent>
                      <ComboboxEmpty>{tr('No matching destination.', 'Không có điểm đến phù hợp.')}</ComboboxEmpty>
                      <ComboboxList>
                        {(group: CityGroup) => (
                          <ComboboxGroup key={group.id} items={group.items}>
                            <ComboboxGroupLabel>{tr(group.label, group.labelVi)}</ComboboxGroupLabel>
                            {group.items.map((city) => (
                              <ComboboxItem key={city.id} value={city}>
                                <span className="flex flex-col items-start">
                                  <span className="font-semibold text-foreground">{tr(city.name, city.nameVi)} · {city.airports.join('/')}</span>
                                  <span className="text-xs text-body">{tr(city.description, city.descriptionVi)}</span>
                                </span>
                              </ComboboxItem>
                            ))}
                          </ComboboxGroup>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>{tr(`Choose a result to add it instantly. Maximum ${MAX_ROUTE_CITIES} destinations.`, `Chọn kết quả để thêm ngay. Tối đa ${MAX_ROUTE_CITIES} điểm đến.`)}</FieldDescription>
                </Field>
              )}
            </div>

            <FormSection icon={CalendarDays} title={tr('Dates and travelers', 'Ngày và số khách')} subtitle={tr('Exact dates make flight and seasonal research useful.', 'Ngày chính xác giúp tìm chuyến bay và mùa phù hợp.')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field className="min-w-0"><FieldLabel htmlFor="trip-start">{tr('Start date', 'Ngày bắt đầu')}</FieldLabel><Input id="trip-start" name="startDate" variant="outline" type="date" min={minDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-11 min-w-0 px-3 py-0" required /></Field>
                <Field className="min-w-0"><FieldLabel>{tr('End date', 'Ngày kết thúc')}</FieldLabel><output htmlFor="trip-start" className="flex h-11 min-w-0 items-center rounded-xl bg-tint px-3 text-sm font-semibold text-body">{endDate ? displayDate(endDate, lang) : tr('Choose start', 'Chọn ngày đầu')}</output></Field>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><p id="trip-days-label" className="text-sm font-medium text-foreground">{tr('Trip length', 'Thời lượng')}</p><Input aria-label={tr('Enter trip length in days', 'Nhập số ngày chuyến đi')} name="days" variant="outline" type="number" inputMode="numeric" min={MIN_TRIP_DAYS} max={MAX_TRIP_DAYS} value={days} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) { daysCustomizedRef.current = true; setDays(clampWholeNumber(event.currentTarget.valueAsNumber, MIN_TRIP_DAYS, MAX_TRIP_DAYS)) } }} onBlur={(event) => { event.currentTarget.value = String(days) }} className="h-10 w-16 shrink-0 px-2 py-0 text-center font-bold tabular-nums" /></div>
                <div className="mt-3"><Slider value={days} min={MIN_TRIP_DAYS} max={MAX_TRIP_DAYS} onChange={(value) => { daysCustomizedRef.current = true; setDays(clampWholeNumber(value, MIN_TRIP_DAYS, MAX_TRIP_DAYS)) }} aria-label={tr('Trip length in days', 'Số ngày của chuyến đi')} /><div className="mt-1 flex justify-between text-2xs text-ink-4"><span>{MIN_TRIP_DAYS}</span><span>{MAX_TRIP_DAYS}</span></div></div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3"><p id="travelers-label" className="text-sm font-medium text-foreground">{tr('Travelers', 'Số khách')}</p><Input aria-label={tr('Enter number of travelers', 'Nhập số khách')} name="travelers" variant="outline" type="number" inputMode="numeric" min={1} max={MAX_TRAVELERS} value={travelers} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) setTravelers(clampWholeNumber(event.currentTarget.valueAsNumber, 1, MAX_TRAVELERS)) }} onBlur={(event) => { event.currentTarget.value = String(travelers) }} className="h-10 w-16 shrink-0 px-2 py-0 text-center font-bold tabular-nums" /></div>
                <div className="mt-3"><Slider value={Math.min(travelers, MAX_TRAVELER_SLIDER)} min={1} max={MAX_TRAVELER_SLIDER} onChange={(value) => setTravelers(clampWholeNumber(value, 1, MAX_TRAVELER_SLIDER))} aria-label={tr('Number of travelers', 'Số khách đi cùng')} /><div className="mt-1 flex justify-between text-2xs text-ink-4"><span>1</span><span>{MAX_TRAVELER_SLIDER}</span></div></div>
              </div>
            </FormSection>

            <FormSection icon={Plane} title={tr('Flight research', 'Tìm chuyến bay')} subtitle={tr('eno checks viable routes and fare signals—not reserved inventory.', 'eno kiểm tra đường bay và tín hiệu giá—không phải chỗ đã giữ.')}>
              <Button type="button" variant="bare" size="none" aria-pressed={includeFlights} onClick={() => setIncludeFlights((value) => !value)} className={cn('h-auto w-full justify-start gap-3 rounded-xl border px-3 py-3 text-left', includeFlights ? 'border-brand bg-accent' : 'border-border bg-card')}>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-md border', includeFlights ? 'border-brand bg-primary text-white' : 'border-line-strong')}>{includeFlights && <Check className="h-3 w-3" />}</span>
                <span className="min-w-0"><span className="block text-sm font-bold text-foreground">{tr('Include flight options', 'Bao gồm lựa chọn chuyến bay')}</span><span className="mt-0.5 block whitespace-normal text-xs text-body">{tr('Optional—add this when you want international flight leads.', 'Không bắt buộc—thêm khi bạn muốn gợi ý chuyến bay quốc tế.')}</span></span>
              </Button>
              {includeFlights && (
                <div className="mt-4 space-y-4">
                  <Field>
                    <FieldLabel htmlFor="trip-origin">{tr('Departure city or airport', 'Thành phố hoặc sân bay khởi hành')}</FieldLabel>
                    <Combobox
                      items={AIRPORT_GROUPS}
                      value={origin || null}
                      inputValue={origin}
                      onValueChange={(value) => setOrigin(value || '')}
                      onInputValueChange={setOrigin}
                      autoHighlight
                    >
                      <ComboboxInputGroup>
                        <Plane className="ml-3 h-4 w-4 shrink-0 text-ink-4" />
                        <ComboboxInput id="trip-origin" name="origin" autoComplete="off" className="px-2" placeholder={tr('Start typing a city or airport code', 'Nhập thành phố hoặc mã sân bay')} required />
                        <ComboboxClear aria-label={tr('Clear departure airport', 'Xóa sân bay khởi hành')} />
                        <ComboboxTrigger aria-label={tr('Show suggested departure airports', 'Hiện sân bay khởi hành gợi ý')} />
                      </ComboboxInputGroup>
                      <ComboboxContent>
                        <ComboboxEmpty>{tr('Keep your typed city or airport—we can still research it.', 'Giữ thành phố hoặc sân bay đã nhập—eno vẫn có thể tìm kiếm.')}</ComboboxEmpty>
                        <ComboboxList>
                          {(group: AirportGroup) => (
                            <ComboboxGroup key={group.id} items={group.items}>
                              <ComboboxGroupLabel>{tr(group.label, group.labelVi)}</ComboboxGroupLabel>
                              {group.items.map((airport) => <ComboboxItem key={airport} value={airport}>{airport}</ComboboxItem>)}
                            </ComboboxGroup>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    <FieldDescription>{tr('Choose a suggestion or keep any city or airport you type.', 'Chọn gợi ý hoặc giữ bất kỳ thành phố hay sân bay nào bạn nhập.')}</FieldDescription>
                  </Field>
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
                {PACES.map((item) => <Radio key={item.id} value={item.id} className={cn('min-w-0 w-full flex-col items-start justify-start whitespace-normal rounded-xl border px-3 py-3 text-left sm:items-center sm:justify-center sm:px-2 sm:text-center', pace === item.id ? 'border-brand bg-accent' : 'border-border bg-card hover:bg-tint')}><span className="text-xs font-bold text-foreground">{tr(item.label, item.labelVi)}</span><span className="mt-1 w-full break-words text-3xs leading-snug text-body">{tr(item.detail, item.detailVi)}</span></Radio>)}
              </RadioGroup>
              <div role="group" aria-label={tr('Trip interests', 'Sở thích chuyến đi')} className="mt-4 flex flex-wrap gap-2">
                {INTERESTS.map(({ id, label, labelVi, Icon }) => <Button key={id} type="button" variant="bare" size="none" aria-pressed={interests.has(id)} onClick={() => toggleInterest(id)} className={cn('gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold', interests.has(id) ? 'border-brand bg-primary text-white' : 'border-border text-body hover:bg-tint')}><Icon className="h-3.5 w-3.5" />{tr(label, labelVi)}</Button>)}
              </div>
            </FormSection>

            <FormSection icon={Info} title={tr('Anything we should know?', 'Điều gì cần lưu ý?')} subtitle={tr('Diet, mobility, children, celebrations, work calls, or hard no’s.', 'Ăn kiêng, di chuyển, trẻ em, dịp đặc biệt, công việc hoặc điều không muốn.')}>
              <Textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={600} rows={3} size="compact" variant="outline" placeholder={tr('Example: vegetarian, avoid early mornings, one traveler has limited mobility…', 'Ví dụ: ăn chay, tránh sáng sớm, một khách hạn chế vận động…')} />
              <p className="mt-1 text-right text-2xs tabular-nums text-ink-4">{notes.length}/600</p>
            </FormSection>
            </div>

            <Button data-testid="build-itinerary" type="submit" variant="cta" size="lg" className="mt-6 w-full" disabled={state === 'building'}>
              {state === 'building' ? <Loader2 className="h-4 w-4 animate-spin" /> : result ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {state === 'building' ? tr('Researching the trip…', 'Đang nghiên cứu chuyến đi…') : result ? tr('Research a new version', 'Nghiên cứu phiên bản mới') : tr('Research and build itinerary', 'Nghiên cứu và tạo lịch trình')}
            </Button>
            <p className="mt-3 text-center text-2xs leading-relaxed text-ink-4">{user ? tr('Includes live web research. Up to 8 plans per account each hour.', 'Bao gồm nghiên cứu web trực tiếp. Tối đa 8 kế hoạch mỗi giờ.') : tr('A unified eno account is required before paid web research runs.', 'Cần tài khoản eno thống nhất trước khi chạy nghiên cứu web trả phí.')}</p>
          </form>
        </Card>

        <section aria-label={tr('Itinerary result', 'Kết quả lịch trình')} className={cn('lg:col-start-2', state === 'ready' ? 'lg:row-start-1' : 'lg:row-start-2')}>
          {state === 'empty' && (
            <Card className="min-h-[620px] items-center justify-center gap-0 px-5 py-12 text-center sm:px-10">
              <span className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-accent-foreground"><Map className="h-9 w-9" /><SearchCheck className="absolute -right-2 -top-2 h-6 w-6 text-brand" /></span>
              <h2 className="mt-6 text-2xl font-bold text-foreground">{tr('Start with one place. eno handles the details.', 'Bắt đầu với một nơi. eno lo phần chi tiết.')}</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-body">{tr('Choose a destination and date. Add flights or more stops only when you need them; eno researches the practical details.', 'Chọn điểm đến và ngày. Chỉ thêm chuyến bay hoặc điểm dừng khi cần; eno sẽ nghiên cứu các chi tiết thực tế.')}</p>
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

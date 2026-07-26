'use client'

// The itinerary planner, ported from the forum (apps/forum itinerary-builder) as a
// NATIVE dashboard surface (owner 2026-07-18). Markup is a near-verbatim port —
// the two apps share the design system — with these eno.vn adaptations:
//   · forumApi → same-origin fetch with the cookie session (no bearer tokens);
//   · money → src/lib/vnd.ts formatMoneyFull (locale-aware, replaces the forum's
//     compact formatVnd);
//   · the generate route auto-saves server-side and returns savedItineraryId —
//     the Save button is the retry path when that save failed;
//   · no forum page chrome: the dashboard layout provides <main>, the plan page
//     provides the mobile SectionHeader.
import { useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarCheck,
  CalendarDays,
  CloudSun,
  Compass,
  Footprints,
  Globe2,
  Hotel,
  Info,
  Landmark,
  Loader2,
  Luggage,
  Map,
  MapPin,
  MoonStar,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Search,
  SearchCheck,
  Sparkles,
  Sun,
  UtensilsCrossed,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { buildItinerarySavePayload } from '@/lib/itinerary-save'
import { cn } from '@/lib/utils'
import {
  addDays,
  BUDGETS,
  CITIES,
  CITY_MAP,
  ACCOMMODATION_LABELS,
  INTEREST_LABELS,
  PACE_LABELS,
  type OptionLabel,
  type AccommodationId,
  type BudgetId,
  type CabinId,
  type City,
  type CityId,
  type GeneratedItineraryResponse,
  type InterestId,
  type PaceId,
  type StopsId,
} from '@/lib/itinerary-data'
import { displayDate, PlannerLoading, PlanResults } from './plan-results'

/**
 * ⚠️ ONLY WHAT THE SHARED TABLE CANNOT CARRY. The labels themselves live in
 * src/lib/itinerary-data.ts (INTEREST_LABELS / ACCOMMODATION_LABELS / PACE_LABELS) and are read
 * from there — this file used to hold a full second copy of all three, which murat flagged as
 * "relocated, not removed" after moving them: the tables became shared and this surface kept
 * duplicating them, so the two could still disagree about what an interest is called.
 *
 * They already did, in a THIRD copy: trip-card.tsx had `wellness` as "Thư giãn" while this file and
 * the shared table both said "Nghỉ dưỡng", so the saved-trip list and the builder disagreed in
 * Vietnamese for the same interest. That is the drift, realised rather than hypothetical.
 *
 * Keyed as Record<Id, …> deliberately, exactly like the shared tables: a new interest is then a
 * COMPILE ERROR here, whereas the arrays these replace would have silently rendered one fewer chip.
 */
const INTEREST_ICONS: Record<InterestId, typeof Landmark> = {
  food: UtensilsCrossed,
  culture: Landmark,
  nature: CloudSun,
  beaches: Sun,
  adventure: Footprints,
  nightlife: MoonStar,
  wellness: Sparkles,
  family: Users,
}

/** The pace one-liner. Not in PACE_LABELS because it is builder chrome — the chat card has no room
 *  for it — but Record-keyed so a new pace cannot silently lose its explanation. */
const PACE_DETAILS: Record<PaceId, { detail: string; detailVi: string }> = {
  slow: { detail: 'One main anchor each day', detailVi: 'Một hoạt động chính mỗi ngày' },
  balanced: { detail: 'Highlights with breathing room', detailVi: 'Điểm nổi bật với thời gian nghỉ' },
  full: { detail: 'More activity, still geographically sensible', detailVi: 'Nhiều hoạt động nhưng vẫn hợp lý' },
}

const INTERESTS = (Object.entries(INTEREST_LABELS) as Array<[InterestId, OptionLabel]>)
  .map(([id, l]) => ({ id, label: l.label, labelVi: l.labelVi, Icon: INTEREST_ICONS[id] }))
const ACCOMMODATIONS = (Object.entries(ACCOMMODATION_LABELS) as Array<[AccommodationId, OptionLabel]>)
  .map(([id, l]) => ({ id, label: l.label, labelVi: l.labelVi }))
const PACES = (Object.entries(PACE_LABELS) as Array<[PaceId, OptionLabel]>)
  .map(([id, l]) => ({ id, label: l.label, labelVi: l.labelVi, ...PACE_DETAILS[id] }))

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

class PlannerApiError extends Error {
  status: number
  constructor(status: number) {
    super(`planner_request_failed_${status}`)
    this.status = status
  }
}

// Same-origin JSON POST riding the cookie session (replaces the forum's forumApi
// bearer-token client — eno.vn IS the backend here).
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!response.ok) throw new PlannerApiError(response.status)
  return response.json() as Promise<T>
}

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

// Shared dropdown body for both city comboboxes (primary destination + add-a-stop);
// the option groups come from the surrounding Combobox root's `items`.
function CityComboboxOptions() {
  const { tr } = useLanguage()
  return (
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
  )
}

export function ItineraryBuilder({ onSaved }: { onSaved?: () => void } = {}) {
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
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
  const daysCustomizedRef = useRef(false)

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

  // Sync the trip total from per-city allocations. Called directly from the two
  // handlers that change allocations (updateCityDays, removeCity) — not an effect —
  // so `days` updates in the same render pass as the edit, from the same next values.
  // daysCustomizedRef is a one-way RATCHET: completing a per-city allocation counts as
  // an explicit choice of trip length, so once it flips true, route edits stop
  // overwriting `days` with the suggested duration (see updateSuggestedDays). It is
  // deliberately never reset — clearing a city's days later should not surrender a
  // total the user already committed to.
  const applyCityDays = (nextCityIds: CityId[], nextCityDays: Partial<Record<CityId, number>>) => {
    if (!nextCityIds.every((id) => nextCityDays[id] != null)) return
    const total = nextCityIds.reduce((sum, id) => sum + (nextCityDays[id] || 0), 0)
    if (total < MIN_TRIP_DAYS || total > MAX_TRIP_DAYS) return
    daysCustomizedRef.current = true
    setDays(total)
  }

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
    const nextDays = { ...cityDays }
    delete nextDays[id]
    setCityIds(next)
    setCityDays(nextDays)
    updateSuggestedDays(next)
    // After updateSuggestedDays on purpose: when removing the only unallocated city
    // completes the allocation, the committed total must win over the suggestion.
    applyCityDays(next, nextDays)
  }

  const updateCityDays = (id: CityId, value: string) => {
    if (value === '') {
      const updated = { ...cityDays }
      delete updated[id]
      setCityDays(updated)
      // No applyCityDays: clearing an entry can only make the allocation incomplete.
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    const nextDays = { ...cityDays, [id]: clampWholeNumber(parsed, 1, MAX_TRIP_DAYS) }
    setCityDays(nextDays)
    applyCityDays(cityIds, nextDays)
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
    // Recompute "today" at submit — minDate is frozen at mount, so a tab left open
    // past midnight can submit a now-past date the server will reject with a 400.
    if (startDate < dateInputValueFromToday(0)) {
      toast.error(tr('The start date has passed. Choose a date from today onward.', 'Ngày bắt đầu đã qua. Hãy chọn từ hôm nay trở đi.'))
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
    try {
      const response = await postJson<GeneratedItineraryResponse>('/api/itineraries/generate', {
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
      })
      setResult(response)
      // The generate route saves the finished plan server-side (cookie session);
      // a null id means that save failed and the Save button becomes the retry.
      setSavedId(response.savedItineraryId ?? null)
      setState('ready')
      window.requestAnimationFrame(() => resultRef.current?.focus())
      if (response.savedItineraryId) {
        onSaved?.() // refresh the saved-history feed rendered beneath the builder
        toast.success(tr('Itinerary saved automatically to your eno dashboard.', 'Lịch trình đã tự động lưu vào bảng điều khiển eno.'))
      }
    } catch (error) {
      if (error instanceof PlannerApiError && error.status === 401) {
        setState('empty')
        openSignIn()
        toast.message(tr('Sign in with your eno account to run live travel research.', 'Đăng nhập tài khoản eno để nghiên cứu chuyến đi trực tiếp.'))
        return
      }
      if (error instanceof PlannerApiError && error.status === 400) {
        // Validation rejection (e.g. a start date that slipped into the past) — not
        // retryable as-is, so return to the form instead of the retryable-error state.
        setState('empty')
        toast.error(tr('Please check the trip details — the planner could not accept them.', 'Vui lòng kiểm tra thông tin chuyến đi — trình lập kế hoạch chưa chấp nhận được.'))
        document.getElementById('trip-start')?.focus()
        return
      }
      setState('error')
      toast.error(error instanceof PlannerApiError && error.status === 429
        ? tr('The planner has reached its research limit. Please try again later.', 'Trình lập kế hoạch đã đạt giới hạn nghiên cứu. Vui lòng thử lại sau.')
        : tr('eno could not complete this plan. Your inputs are still here—please retry.', 'eno chưa thể hoàn thành kế hoạch. Thông tin vẫn được giữ—hãy thử lại.'))
    }
  }

  const persistPlan = async (nextResult: GeneratedItineraryResponse, announce: boolean) => {
    if (!user) return null
    setSaving(true)
    try {
      const { itinerary } = await postJson<{ itinerary: { id: string } }>('/api/itineraries',
        buildItinerarySavePayload({ result: nextResult, cityIds, days, budgetId, interests }))
      setSavedId(itinerary.id)
      onSaved?.() // refresh the saved-history feed rendered beneath the builder
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
    <div className="pb-10">
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
                    <CityComboboxOptions />
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
                    <CityComboboxOptions />
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
              {/* ui/checkbox (Base UI) instead of the ported hand-painted square-in-a-Button:
                  the label wrap keeps the whole card clickable — label activation lands on
                  Base UI's hidden form input, which toggles the Root (same pattern as the
                  visa Consent card). */}
              <label className={cn('flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors', includeFlights ? 'border-brand bg-accent' : 'border-border bg-card hover:bg-tint')}>
                <Checkbox checked={includeFlights} onChange={setIncludeFlights} name="includeFlights" className="mt-0.5 h-5 w-5" />
                <span className="min-w-0"><span className="block text-sm font-bold text-foreground">{tr('Include flight options', 'Bao gồm lựa chọn chuyến bay')}</span><span className="mt-0.5 block whitespace-normal text-xs text-body">{tr('Optional—add this when you want international flight leads.', 'Không bắt buộc—thêm khi bạn muốn gợi ý chuyến bay quốc tế.')}</span></span>
              </label>
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
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-semibold text-body">
                    <Checkbox checked={checkedBags} onChange={setCheckedBags} name="checkedBags" />
                    <Luggage className="h-3.5 w-3.5 shrink-0" />
                    {tr('Checked baggage needed', 'Cần hành lý ký gửi')}
                  </label>
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
    </div>
  )
}

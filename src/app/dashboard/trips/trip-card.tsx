'use client'

import { CalendarDays, ChevronDown } from 'lucide-react'
import { Collapsible } from '@base-ui/react/collapsible'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

// Row shapes = the /api/itineraries GET serializer (Prisma rows, dates as ISO strings,
// interests pre-parsed to string[]).
export type SavedItineraryDay = {
  id: string
  dayNumber: number
  area: string
  areaVi: string | null
  title: string
  titleVi: string | null
  morning: string
  morningVi: string | null
  afternoon: string
  afternoonVi: string | null
  evening: string
  eveningVi: string | null
}

export type SavedItineraryStay = {
  id: string
  position: number
  name: string
  nameVi: string | null
  area: string
  areaVi: string | null
  note: string | null
  noteVi: string | null
  estimatedNightly: number | null
  currency: string
}

export type SavedItinerary = {
  id: string
  title: string
  destinationId: string
  days: number
  budgetId: string
  interests: string[]
  status: string
  estimatedBudget: number | null
  currency: string
  updatedAt: string
  dayPlans: SavedItineraryDay[]
  stays: SavedItineraryStay[]
}

// destinationId → [en, vi] display names, mirrored from the forum planner's city
// catalogue (eno-forum itinerary-data — ids are stable). Display-only: an unknown
// id falls back to the prettified slug, never breaks the row.
const CITY_NAMES: Record<string, [string, string]> = {
  hanoi: ['Hanoi', 'Hà Nội'],
  halong: ['Ha Long & Lan Ha Bay', 'Hạ Long & vịnh Lan Hạ'],
  ninhbinh: ['Ninh Binh & Tam Coc', 'Ninh Bình & Tam Cốc'],
  sapa: ['Sa Pa', 'Sa Pa'],
  hagiang: ['Ha Giang', 'Hà Giang'],
  caobang: ['Cao Bang', 'Cao Bằng'],
  puluong: ['Pu Luong & Mai Chau', 'Pù Luông & Mai Châu'],
  hue: ['Hue', 'Huế'],
  danang: ['Da Nang', 'Đà Nẵng'],
  hoian: ['Hoi An', 'Hội An'],
  phongnha: ['Phong Nha', 'Phong Nha'],
  quynhon: ['Quy Nhon', 'Quy Nhơn'],
  nhatrang: ['Nha Trang', 'Nha Trang'],
  dalat: ['Da Lat', 'Đà Lạt'],
  buonmathuot: ['Buon Ma Thuot', 'Buôn Ma Thuột'],
  hochiminh: ['Ho Chi Minh City', 'TP. Hồ Chí Minh'],
  mekong: ['Ben Tre & Mekong Delta', 'Bến Tre & miền Tây'],
  cantho: ['Can Tho', 'Cần Thơ'],
  muine: ['Mui Ne & Phan Thiet', 'Mũi Né & Phan Thiết'],
  phuquoc: ['Phu Quoc', 'Phú Quốc'],
  condao: ['Con Dao', 'Côn Đảo'],
}

const INTEREST_LABELS: Record<string, [string, string]> = {
  food: ['Food', 'Ẩm thực'],
  culture: ['Culture', 'Văn hóa'],
  nature: ['Nature', 'Thiên nhiên'],
  beaches: ['Beaches', 'Biển'],
  adventure: ['Adventure', 'Phiêu lưu'],
  nightlife: ['Nightlife', 'Về đêm'],
  wellness: ['Wellness', 'Thư giãn'],
  family: ['Family', 'Gia đình'],
}

// Itinerary currency column stores ISO 'VND'; formatMoneyFull's VND branch keys on '₫'.
function money(amount: number, currency: string, locale: 'en' | 'vi'): string {
  return formatMoneyFull(amount, currency === 'VND' ? '₫' : currency, locale)
}

/** One saved itinerary: summary row (title / destination / day count / updated date)
 *  that expands in place to the full day-by-day plan + stay shortlist. Disclosure is
 *  Base UI Collapsible used directly — no ui/ collapsible primitive exists yet and this
 *  is its only call site (same direct-import precedent as availability-client). */
export function TripCard({ trip }: { trip: SavedItinerary }) {
  const { lang, tr } = useLanguage()
  const vi = lang === 'vi'
  // Day/stay copy is bilingual DATA (columns), not UI strings: vi column when the UI is
  // Vietnamese and the column is filled; English text otherwise (also the MT-language case).
  const loc = (en: string, viText: string | null | undefined) => (vi && viText ? viText : en)

  const city = trip.destinationId ? CITY_NAMES[trip.destinationId] : undefined
  const destination = city ? (vi ? city[1] : city[0]) : (trip.destinationId ?? '').replace(/[-_]/g, ' ')
  const updated = new Date(trip.updatedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const budget = trip.estimatedBudget ? money(trip.estimatedBudget, trip.currency, moneyLocale(lang)) : null

  return (
    <Collapsible.Root render={<article className="overflow-hidden rounded-2xl border border-line-strong bg-card" />}>
      <Collapsible.Trigger
        render={
          // Overrides live on the Button (cn-merged); a className on a render CHILD would
          // only concatenate. bare/none: the row owns its box; the base keeps focus ring.
          <Button
            variant="bare"
            size="none"
            className="group w-full items-start justify-start gap-3 whitespace-normal p-4 text-left font-normal active:scale-100"
          />
        }
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <CalendarDays className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-foreground">{trip.title}</span>
            {trip.status === 'draft' && <Badge variant="neutral">{tr('Draft', 'Bản nháp')}</Badge>}
          </span>
          <span className="mt-1 block text-xs text-body">
            {destination} · {trip.days} {tr('days', 'ngày')}
            {budget ? ` · ${budget}` : ''} · {tr('Updated', 'Cập nhật')} {updated}
          </span>
        </span>
        <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-ink-4 transition-transform group-data-[panel-open]:rotate-180" />
      </Collapsible.Trigger>

      <Collapsible.Panel className="border-t border-border px-4 py-4">
        {Array.isArray(trip.interests) && trip.interests.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {trip.interests.map((interest) => {
              const label = INTEREST_LABELS[interest]
              return (
                <Badge key={interest} variant="neutral">
                  {label ? (vi ? label[1] : label[0]) : interest}
                </Badge>
              )
            })}
          </div>
        )}

        <ol className="space-y-4">
          {trip.dayPlans.map((day) => (
            <li key={day.id} className="border-l-2 border-primary/30 pl-3">
              <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                {tr('Day', 'Ngày')} {day.dayNumber} · {loc(day.area, day.areaVi)}
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">{loc(day.title, day.titleVi)}</p>
              <div className="mt-2 space-y-1 text-xs leading-relaxed text-body">
                <p>
                  <strong className="font-semibold text-foreground">{tr('Morning', 'Sáng')}:</strong>{' '}
                  {loc(day.morning, day.morningVi)}
                </p>
                <p>
                  <strong className="font-semibold text-foreground">{tr('Afternoon', 'Chiều')}:</strong>{' '}
                  {loc(day.afternoon, day.afternoonVi)}
                </p>
                <p>
                  <strong className="font-semibold text-foreground">{tr('Evening', 'Tối')}:</strong>{' '}
                  {loc(day.evening, day.eveningVi)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {trip.stays.length > 0 && (
          <div className="mt-5 rounded-xl bg-tint p-4">
            <p className="text-2xs font-bold uppercase tracking-wide text-foreground">
              {tr('Stay shortlist', 'Danh sách chỗ ở')}
            </p>
            <ul className="mt-2 space-y-2 text-xs text-body">
              {trip.stays.map((stay) => (
                <li key={stay.id}>
                  <strong className="font-semibold text-foreground">{loc(stay.name, stay.nameVi)}</strong> ·{' '}
                  {loc(stay.area, stay.areaVi)}
                  {stay.estimatedNightly
                    ? ` · ${money(stay.estimatedNightly, stay.currency, moneyLocale(lang))}/${tr('night', 'đêm')}`
                    : ''}
                  {stay.note && <span className="block text-muted-foreground">{loc(stay.note, stay.noteVi)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

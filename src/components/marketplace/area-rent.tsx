'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
import { formatCalendarDay } from '@/lib/calendar-day'
import { compactPrice, formatInteger, moneyLocale } from '@/lib/vnd'
import type { AreaRent as AreaRentData, AreaRentKind } from '@/lib/area-rent'

/**
 * "What do places like this rent for here?" — a rental's twin of the goods' Market price line (market-price.tsx): the
 * /hcmc-rent-index middle half for the cell this listing is counted in, and where its rent sits. Figures, cell and verdict
 * come from src/lib/area-rent.ts (the index's own rules and publishing threshold); this only chooses words.
 * ⛔ NO `use()`, NO EFFECT, NO CLOCK: the server resolves the snapshot, so the first HTML holds the line (JavaScript off),
 * which is the point — it is the text that makes one GoPlus room's page differ from the next (owner, 2026-11-19).
 * ⚠️ Words only, no colour and no gauge: the label links the index, the way the Market price label links its model page.
 * Literal `tr()` pairs, so the harvester sees each; the kind labels reuse the index table's Vietnamese (district-rent.tsx).
 */
type Tr = ReturnType<typeof useLanguage>['tr']

function kindLabel(kind: AreaRentKind, tr: Tr): string {
  switch (kind) {
    case 'studio': return tr('a studio', 'studio')
    case 'br1': return tr('a 1-bedroom apartment', 'căn hộ 1 phòng ngủ')
    case 'br2': return tr('a 2-bedroom apartment', 'căn hộ 2 phòng ngủ')
    case 'br3plus': return tr('an apartment with 3+ bedrooms', 'căn hộ từ 3 phòng ngủ')
    case 'apartment': return tr('an apartment', 'căn hộ')
    case 'house': return tr('a house', 'nhà nguyên căn')
    default: return tr('a room', 'phòng trọ')
  }
}

function verdict(position: AreaRentData['position'], tr: Tr): string {
  if (position === 'below') return tr('This rent is below the typical range.', 'Giá thuê này thấp hơn mức phổ biến.')
  if (position === 'above') return tr('This rent is above the typical range.', 'Giá thuê này cao hơn mức phổ biến.')
  return tr('This rent is within the typical range.', 'Giá thuê này nằm trong mức phổ biến.')
}

export function AreaRent({ rent }: { rent: AreaRentData }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  const range = rent.low === rent.high ? compactPrice(rent.low, loc) : `${compactPrice(rent.low, loc)} – ${compactPrice(rent.high, loc)}`
  return (
    <div className="text-sm text-body">
      <p>
        <Link href="/hcmc-rent-index" prefetch={false} className="underline underline-offset-4 hover:text-foreground">
          {/* i18n-invariant: {place} is a place name (PlaceName's rule); the sentence around it translates. */}
          <Bilingual en="Typical rent for {kind} in {place}" vi="Giá thuê phổ biến cho {kind} tại {place}" values={{ kind: kindLabel(rent.kind, tr), place: lang === 'vi' ? rent.place.vi : rent.place.en }} />
        </Link>
        : <span className="font-bold text-foreground tabular-nums">{range}</span> {tr('a month', 'mỗi tháng')}. {verdict(rent.position, tr)}
      </p>
      <p className="mt-1 text-t-meta text-ink-4">
        {tr('HCMC Rent Index', 'Chỉ số giá thuê nhà TP.HCM')} ·{' '}
        <Bilingual en="asking rents of {n} listings, {date}" vi="giá chào thuê của {n} tin, ngày {date}" values={{ n: formatInteger(rent.n, loc), date: formatCalendarDay(rent.asOf, lang) }} />
      </p>
    </div>
  )
}

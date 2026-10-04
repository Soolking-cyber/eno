'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
import { formatCalendarDay } from '@/lib/calendar-day'
import { ArrowRight } from '@/components/ui/icons'
import { formatMoneyFull, groupVnd } from '@/lib/vnd'
import { roundForDisplay } from '@/lib/rent-index'
import type { RentCell, RentCellKind } from '@/lib/district-rent-cells'

/**
 * THE RENT BLOCK ON A RENTALS DISTRICT PAGE (SEO wave B, D2; copy CS-2 D2-1…D2-13, approved
 * 2026-09-30): this district's figures from /hcmc-rent-index — figures computed here, which is what
 * lets the page be submitted (D3).
 *
 * ⛔ A CLIENT COMPONENT WITH NO `use()` AND NO CLOCK. The server resolves the snapshot, picks the cells
 * (`publishableCells`, the one definition D3 also reads) and formats the date in Ho Chi Minh City time
 * for both languages; this only chooses words. So the first HTML already holds the block (JavaScript
 * off), and hydration has nothing to disagree about (react-use-before-hooks, #467).
 * ⚠️ LABELS FOLLOW THE INDEX'S OWN WORDS ("Nhà nguyên căn", not the lede's "nhà"): these are its
 * figures and must read like its table. Literal `tr()` pairs, so the harvester sees each.
 */
export type DistrictRentProps = {
  /** The DISTRICTS label — the block keeps it (D1's search labels are for the title, H1, description). */
  place: { en: string; vi: string }
  slug: string
  cells: RentCell[]
  /** The snapshot day, formatted on the server (formatCalendarDay, HCMC time); `iso` lets the nine
   *  machine-translated languages print it with their own month name. */
  asOf: { en: string; vi: string; iso?: string }
}

function CellLabel({ kind }: { kind: RentCellKind }) {
  const { tr } = useLanguage()
  switch (kind) {
    case 'br1': return <>{tr('1-bedroom apartments', 'Căn hộ 1 phòng ngủ')}</>
    case 'br2': return <>{tr('2-bedroom apartments', 'Căn hộ 2 phòng ngủ')}</>
    case 'br3plus': return <>{tr('Apartments, 3+ bedrooms', 'Căn hộ từ 3 phòng ngủ')}</>
    case 'apartment': return <>{tr('Apartments, all sizes', 'Căn hộ, mọi số phòng ngủ')}</>
    case 'house': return <>{tr('Houses', 'Nhà nguyên căn')}</>
    default: return <>{tr('Rooms', 'Phòng trọ')}</>
  }
}

/** The District 2 / 9 and Thủ Đức notes (CS-2 D2-11, D2-12): the rows overlap, and say so. */
const FORMER = { d2: { en: 'District 2', vi: 'Quận 2' }, d9: { en: 'District 9', vi: 'Quận 9' } } as const

function OverlapNote({ slug }: { slug: string }) {
  const { lang, tr } = useLanguage()
  if (slug === 'thu-duc') {
    return <p className="mt-1 text-xs text-muted-foreground">{tr('All of Thu Duc City, including listings still labelled District 2 or 9', 'Toàn bộ TP Thủ Đức, gồm cả các tin vẫn ghi Quận 2 hoặc Quận 9')}</p>
  }
  if (slug !== 'd2' && slug !== 'd9') return null
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {/* One template, not "Listings labelled" + a name: word order is the translation's to decide.
          i18n-invariant: the district name is a place name and stays as written (PlaceName's rule). */}
      <Bilingual en="Listings labelled {name}." vi="Các tin ghi {name}." values={{ name: lang === 'vi' ? FORMER[slug].vi : FORMER[slug].en }} />{' '}
      {tr('They are also counted in Thu Duc City.', 'Các tin này cũng được tính trong TP Thủ Đức.')}
    </p>
  )
}

export function DistrictRent({ place, slug, cells, asOf }: DistrictRentProps) {
  const { lang, tr } = useLanguage()
  if (cells.length === 0) return null
  const locale = lang === 'vi' ? 'vi' : 'en'
  return (
    <section className="mt-6 max-w-3xl border-t border-border pt-4" aria-labelledby="district-rent">
      <h2 id="district-rent" className="text-base font-bold text-foreground">
        {/* i18n-invariant: {place} is a place name (PlaceName's rule); the sentence around it translates. */}
        <Bilingual en="Median asking rent in {place}" vi="Giá thuê chào trung vị tại {place}" values={{ place: lang === 'vi' ? place.vi : place.en }} />
      </h2>
      <OverlapNote slug={slug} />
      {/* A <dl> of label → figure on a ruled grid (flat-surface canon §3b): no tiles, no boxes. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.kind} className="min-w-0">
            <dt className="text-xs font-semibold text-muted-foreground"><CellLabel kind={c.kind} /></dt>
            <dd className="mt-0.5">
              <span className="block font-bold tabular-nums text-foreground">{formatMoneyFull(roundForDisplay(c.median), '₫', locale)}</span>
              <span className="block text-xs text-body">{tr('per month', 'mỗi tháng')}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">{groupVnd(String(c.n), locale)} {tr('listings', 'tin')}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {tr('Asking prices from live listings, not signed rents.', 'Giá chào từ các tin đang đăng, không phải giá thuê đã ký.')}{' '}
        <Bilingual en="As of {date}." vi="Số liệu ngày {date}." values={{ date: lang === 'vi' ? asOf.vi : lang === 'en' || !asOf.iso ? asOf.en : formatCalendarDay(asOf.iso, lang) }} />
      </p>
      <p className="mt-2 text-sm">
        <Link href="/hcmc-rent-index" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
          {tr('How these figures are calculated, and every district', 'Cách tính và số liệu của mọi quận')} <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      </p>
    </section>
  )
}

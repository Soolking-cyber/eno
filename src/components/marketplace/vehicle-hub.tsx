import Link from 'next/link'
import { ArrowRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { SeoArticle, P, Ul, HereLink, type ArticleContent, type ArticleSection } from './seo-article'
import { SellerListings } from './seller-listings'
import { DISTRICTS } from './listings-explorer.constants'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { formatMoneyFull } from '@/lib/vnd'
import { SITE_NAME } from '@/lib/edition'
import { BAND_MIN, RANGE_MIN, hcmcIsoDate, linkState, referenceSources, type LinkState, type PriceSummary } from '@/lib/vehicle-hub-stats'
import type { VehicleHubData, VehicleHubKind } from '@/lib/vehicle-hubs'
import { hubBooking, hubDisclosure, hubIntro, type HubCopyInput } from '@/lib/vehicle-hub-copy'

/**
 * THE HCMC VEHICLE-HIRE HUBS — four URLs, one component: {car, motorbike} × {en, vi}.
 *
 *   /car-rental-ho-chi-minh-city        ↔ /thue-xe-tu-lai-tphcm
 *   /motorbike-rental-ho-chi-minh-city  ↔ /thue-xe-may-tphcm
 *
 * ⛔ WHY THESE PAGES AND NOT THE ~6,400 LISTING PAGES. The imported reference listings copy their
 * sources' pages, so they are browsable but `noindex` (src/lib/rental-places.ts
 * `isVehicleHireReference`, applied on the PDP) and never in a sitemap (src/lib/sitemap.ts excludes
 * every `affiliateUrl` row). What eno.vn adds that no single source does — every source on one page,
 * counts, and a price summary whose method is printed — lives HERE, on four indexable URLs.
 * (OpenSEO keyword data 2026-09-28: "thuê xe tự lái" 22,200/mo KD 4, "thuê xe máy sài gòn" 5,400,
 * "car rental ho chi minh" 880 KD 0, "motorbike rental ho chi minh" 480 KD 5; Tin deep-dive the same day.)
 *
 * ⚠️ THE PROSE IS WRITTEN IN THE PAGE'S LANGUAGE, NOT THE VISITOR'S — the SeoArticle contract. A
 * Vietnamese page is Vietnamese for everyone; the English page's reader gets the English one. The
 * hreflang pair (src/lib/expat-guides.ts) is what sends each searcher to theirs.
 *
 * ⚠️ NO FAQ BLOCK (FAQ rich results ended 2026-05-07) and NO Product/Offer schema — these are rentals
 * booked elsewhere, not goods for sale here. The only JSON-LD is SeoArticle's Article node.
 *
 * ⛔ NO LEGAL CLAIM ABOUT LICENCES. Which licence a foreigner may drive on depends on nationality,
 * permit convention and vehicle class; that guide is held for legal review. One neutral sentence
 * sends the reader to the rental company instead.
 */

type Lang = 'en' | 'vi'

const SUB: Record<VehicleHubKind, string> = { car: 'car-rental', motorbike: 'motorbike-rental' }
const explorer = (kind: VehicleHubKind, extra = '') => `/?category=rentals&subcategory=${SUB[kind]}${extra}`

export const VEHICLE_HUB_SLUGS: Record<VehicleHubKind, Record<Lang, string>> = {
  car: { en: 'car-rental-ho-chi-minh-city', vi: 'thue-xe-tu-lai-tphcm' },
  motorbike: { en: 'motorbike-rental-ho-chi-minh-city', vi: 'thue-xe-may-tphcm' },
}

const count = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US').format(n)
const money = (n: number, lang: Lang) => formatMoneyFull(n, '₫', lang)
const date = (d: Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(d)

/**
 * A stored district → the explorer's chip slug and a label in the page's language, if it has one.
 * ⚠️ THE SOURCES SPELL ONE PLACE SEVERAL WAYS — "Quận Thủ Đức", "TP Thủ Đức" and "Thành Phố Thủ Đức"
 * are all Thu Duc City; "Quận Bình Tân" is the chip named "Bình Tân". So the administrative prefix is
 * stripped before matching, and `mergeDistricts` adds up every spelling that resolves to one chip.
 */
const PLACE_PREFIX = /^(quận|huyện|thị xã|thành phố|tp\.?)\s+/i
function districtChip(stored: string, lang: Lang): { slug: string | null; label: string } {
  const candidates = [stored, stored.replace(PLACE_PREFIX, '')].map((x) => x.trim().toLowerCase())
  const d = DISTRICTS.find((x) =>
    candidates.some((s) => x.name.toLowerCase() === s || x.nameEn.toLowerCase() === s || x.match?.some((m) => m.toLowerCase() === s)))
  if (!d) return { slug: null, label: stored }
  return { slug: d.slug, label: lang === 'vi' ? d.name : d.nameEn }
}

/** Every spelling of one place counted once, largest first, at most `limit`. */
export function mergeDistricts(raw: { district: string; count: number }[], lang: Lang, limit = 8) {
  const m = new Map<string, { slug: string | null; label: string; count: number }>()
  for (const r of raw) {
    const chip = districtChip(r.district, lang)
    const key = chip.slug ?? chip.label
    const cur = m.get(key) ?? { ...chip, count: 0 }
    cur.count += r.count
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

/** One summary line, in words, with n always shown. */
function summaryText(s: PriceSummary, per: string, lang: Lang): React.ReactNode {
  if (s.n === 0) return lang === 'vi' ? <>hiện chưa có xe nào</> : <>none listed right now</>
  if (s.kind === 'too-few') {
    return lang === 'vi'
      ? <>chỉ có {count(s.n, lang)} xe — quá ít để tính giá tiêu biểu</>
      : <>only {count(s.n, lang)} listed — too few to summarise</>
  }
  if (s.kind === 'range') {
    return lang === 'vi'
      ? <>từ <strong>{money(s.min, lang)}</strong> đến <strong>{money(s.max, lang)}</strong>/{per} ({count(s.n, lang)} xe; chưa đủ {BAND_MIN} xe để tính trung vị)</>
      : <>from <strong>{money(s.min, lang)}</strong> to <strong>{money(s.max, lang)}</strong> a {per} ({count(s.n, lang)} listed; under {BAND_MIN}, so no median)</>
  }
  return lang === 'vi'
    ? <>trung vị <strong>{money(s.median, lang)}/{per}</strong>; một nửa số xe nằm trong khoảng {money(s.p25, lang)}–{money(s.p75, lang)} ({count(s.n, lang)} xe)</>
    : <>median <strong>{money(s.median, lang)} a {per}</strong>; the middle half run {money(s.p25, lang)}–{money(s.p75, lang)} ({count(s.n, lang)} listed)</>
}

function Grid({ data, lang }: { data: VehicleHubData; lang: Lang }) {
  const noun = data.kind === 'car' ? (lang === 'vi' ? 'xe ô tô' : 'cars') : (lang === 'vi' ? 'xe máy' : 'motorbikes')
  return (
    <>
      <div className="mt-4">
        <SellerListings
          listings={data.listings}
          sortable={data.total > 1}
          sortBase={explorer(data.kind)}
          scope={{ shown: data.listings.length, total: data.total }}
        />
      </div>
      <div className="mt-6">
        {/* whitespace-normal ON THE PRIMITIVE (a class on the child is concatenated, not merged — CLAUDE.md):
            the base is nowrap, and the Vietnamese label overflowed a 360px screen by 39px (measured). */}
        <Button asChild variant="cta" size="none" className="gap-1.5 whitespace-normal text-left">
          <Link href={explorer(data.kind)} className="px-5 py-2.5">
            {lang === 'vi' ? `Xem tất cả ${count(data.total, lang)} ${noun}, có bộ lọc` : `See all ${count(data.total, lang)} ${noun} with filters`}{' '}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </>
  )
}

/** "A", "A and B", "A, B, and C" — the linked sources only (vehicle-hub-stats.ts referenceSources). */
function joinNames(names: string[], lang: Lang): string {
  // ⚠️ AT MOST THREE NAMES: this string is printed in the intro, the disclosure AND the booking
  // paragraph, so fifteen shops would be the same fifteen-name list three times on one screen (opus).
  if (names.length > 3) {
    const more = names.length - 2
    return lang === 'vi' ? `${names.slice(0, 2).join(', ')} và ${more} nguồn khác` : `${names.slice(0, 2).join(', ')} and ${more} others`
  }
  if (names.length <= 2) return names.join(lang === 'vi' ? ' và ' : ' and ')
  return `${names.slice(0, -1).join(', ')}${lang === 'vi' ? ' và ' : ', and '}${names[names.length - 1]}`
}

function provenance(data: VehicleHubData, lang: Lang): ArticleSection {
  const state = linkState(data.total, data.linked)
  const from = joinNames(referenceSources(data.sources), lang)
  const refNote = lang === 'vi'
    ? state === 'all'
      ? 'Mỗi tin là một tin tham khảo: nội dung và giá do nguồn đăng, và nút trên trang dẫn thẳng tới trang đặt xe của nguồn đó. '
      : state === 'some' ? `Tin từ ${from} là tin tham khảo: nội dung và giá do nguồn đăng, và nút trên trang dẫn tới trang đặt xe của nguồn; các tin còn lại do chủ xe đăng trực tiếp trên ${SITE_NAME}. ` : ''
    : state === 'all'
      ? 'Each one is a reference listing: the details and the price are the source’s, and its button goes straight to the source’s booking page. '
      : state === 'some' ? `Listings from ${from} are reference listings: the details and price are the source’s, and the button goes to its booking page; the rest are posted directly on ${SITE_NAME} by their owners. ` : ''
  return {
    id: lang === 'vi' ? 'nguon-du-lieu' : 'where-this-comes-from',
    title: lang === 'vi' ? 'Dữ liệu lấy từ đâu' : 'Where these listings come from',
    body: (
      <>
        <Ul>
          {/* ⛔ ONLY SOURCES WHOSE ROWS BOOK ELSEWHERE ARE NAMED. A person who posts a scooter on the site
              is not a "source", and printing their name on an indexable page is exactly what
              vehicle-hub-copy.ts promises not to do — they are one count line below (opus, 2026-09-29). */}
          {data.sources.filter((s) => s.linkedCount > 0).map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> — {count(s.linkedCount, lang)} {lang === 'vi' ? 'tin' : s.linkedCount === 1 ? 'listing' : 'listings'}
            </li>
          ))}
          {data.total - data.linked > 0 && (
            <li>
              {lang === 'vi'
                ? <>{count(data.total - data.linked, lang)} tin do chủ xe đăng trực tiếp trên {SITE_NAME}</>
                : <>{count(data.total - data.linked, lang)} posted directly on {SITE_NAME} by their owners</>}
            </li>
          )}
        </Ul>
        <P>
          {lang === 'vi'
            ? <>{refNote}Danh sách được đối chiếu lại với các nguồn mỗi tuần; tin nào nguồn gỡ xuống thì được ẩn khỏi trang này.{data.lastChange ? <> Lần cập nhật gần nhất được ghi nhận: {date(data.lastChange, lang)}.</> : null}</>
            : <>{refNote}The list is re-checked against the sources every week, and a listing the source takes down is hidden here.{data.lastChange ? <> Most recent change recorded: {date(data.lastChange, lang)}.</> : null}</>}
        </P>
        <P>
          {lang === 'vi'
            ? <>Cách tính giá ở trên: chỉ dùng giá niêm yết của các tin đang hiển thị; giá theo ngày và theo tháng tính riêng, không bao giờ suy ra từ nhau. Nhóm có từ {BAND_MIN} xe trở lên thì ghi trung vị và khoảng của một nửa số xe ở giữa; nhóm từ {RANGE_MIN} đến {BAND_MIN - 1} xe chỉ ghi giá thấp nhất và cao nhất; ít hơn nữa thì không ghi. Giá làm tròn tới 1.000 đ. Một chiếc xe đăng trên hai nguồn sẽ được đếm hai lần, vì các nguồn không công bố thông tin để nhận ra điều đó.{data.kind === 'motorbike' ? ' Cửa hàng báo giá bằng đô la Mỹ được quy đổi theo tỷ giá ngày nhập, và trang của từng xe ghi rõ giá gốc.' : ''}</>
            : <>How the prices above are worked out: only the listed prices of the listings shown here; day and month prices are kept separate and never derived from each other. A group of {BAND_MIN} or more gets a median and the range of its middle half; {RANGE_MIN} to {BAND_MIN - 1} gets only its lowest and highest price; fewer gets no figure. Prices are shown to the nearest 1,000 đ. A vehicle listed on two sources is counted twice — the sources do not publish anything that would let us tell.{data.kind === 'motorbike' ? ' Shops that quote in US dollars are converted at the rate on the day of import, and each listing shows the shop’s own figure.' : ''}</>}
        </P>
      </>
    ),
  }
}

function carSections(data: VehicleHubData, lang: Lang): ArticleSection[] {
  const c = Object.fromEntries(data.cohorts.map((x) => [x.key, x.summary]))
  const per = lang === 'vi' ? 'ngày' : 'day'
  const vi = lang === 'vi'
  return [
    {
      id: vi ? 'xe-dang-cho-thue' : 'cars-available-now',
      title: vi ? 'Xe đang cho thuê' : 'Cars available now',
      body: <Grid data={data} lang={lang} />,
    },
    {
      id: vi ? 'gia-thue-mot-ngay' : 'what-a-day-costs',
      title: vi ? 'Thuê xe tự lái một ngày giá bao nhiêu' : 'What a day of self-drive hire costs',
      body: (
        <>
          <Ul>
            <li>{vi ? 'Tất cả xe' : 'All cars'}: {summaryText(c.all, per, lang)}.</li>
            <li>{vi ? 'Xe 4–5 chỗ' : '4–5 seats'}: {summaryText(c['seats-4-5'], per, lang)}.</li>
            <li>{vi ? 'Xe 7 chỗ' : '7 seats'}: {summaryText(c['seats-7'], per, lang)}.</li>
            <li>{vi ? 'Xe điện VinFast' : 'VinFast electric'}: {summaryText(c.vinfast, per, lang)}.</li>
          </Ul>
          <P>
            {vi
              ? 'Đây là giá thuê theo ngày mà nguồn niêm yết, trước khuyến mãi của họ. Tiền cọc, phí giao xe, giới hạn số km và bảo hiểm do từng nguồn quy định — xem trên trang đặt xe trước khi quyết định.'
              : 'These are the day rates each source lists, before its own discounts. Deposit, delivery fee, mileage limit and insurance are set by each source — check them on the booking page before you commit.'}
          </P>
        </>
      ),
    },
    {
      id: vi ? 'chon-theo-loai-xe' : 'by-size',
      title: vi ? 'Chọn theo loại xe' : 'By size: 4–5 seats, 7 seats or electric',
      body: (
        <Ul>
          <li>
            <HereLink href={explorer('car', '&attr_seats=4')}>{vi ? 'Xe 4 chỗ' : '4-seat cars'}</HereLink>{' '}
            {vi ? 'và' : 'and'} <HereLink href={explorer('car', '&attr_seats=5')}>{vi ? 'xe 5 chỗ' : '5-seat cars'}</HereLink>{' '}
            — {count(data.counts['seats-4-5'] ?? 0, lang)} {vi ? 'xe, hợp đi trong thành phố và đi hai, ba người.' : 'between them; the easiest to park in the city.'}
          </li>
          <li>
            <HereLink href={explorer('car', '&attr_seats=7')}>{vi ? 'Xe 7 chỗ' : '7-seat cars'}</HereLink>{' '}
            — {count(data.counts['seats-7'] ?? 0, lang)} {vi ? 'xe, cho gia đình hoặc chuyến đi xa có nhiều hành lý.' : 'for a family or a trip out of the city with luggage.'}
          </li>
          <li>
            <HereLink href={explorer('car', '&q=vinfast')}>{vi ? 'Xe điện VinFast' : 'VinFast electric cars'}</HereLink>{' '}
            — {count(data.counts.vinfast ?? 0, lang)} {vi ? 'xe. Hỏi nguồn về pin khi nhận xe và trạm sạc trên đường đi.' : 'listed. Ask the source how charged the battery will be at pickup and where you can charge on your route.'}
          </li>
        </Ul>
      ),
    },
    ...(data.districts.length > 0
      ? [{
          id: vi ? 'xe-o-dau' : 'where-the-cars-are',
          title: vi ? 'Xe ở khu vực nào' : 'Where the cars are',
          body: (
            <>
              <P>
                {vi
                  ? 'Nơi chủ xe để xe. Nhiều xe có giao tận nơi (có phí), nên xe ở quận khác vẫn có thể tới chỗ bạn.'
                  : 'Where each car is parked. Many can be delivered for a fee, so a car in another district can still come to you.'}
              </P>
              <Ul>
                {mergeDistricts(data.districts, lang).map((d) => (
                  <li key={d.slug ?? d.label}>
                    {d.slug ? <HereLink href={explorer('car', `&district=${d.slug}`)}>{d.label}</HereLink> : d.label} — {count(d.count, lang)} {vi ? 'xe' : d.count === 1 ? 'car' : 'cars'}
                  </li>
                ))}
              </Ul>
            </>
          ),
        }]
      : []),
    {
      id: vi ? 'dat-xe-the-nao' : 'how-booking-works',
      title: vi ? 'Đặt xe như thế nào' : 'How booking works',
      body: (
        <>
          <P>
            {hubBooking(hubCopy(data, lang))}
          </P>
          <P>
            {vi
              ? 'Giấy phép lái xe được chấp nhận tùy quốc tịch và loại giấy phép bạn có. Hãy hỏi rõ bên cho thuê trước khi đặt.'
              : 'Which driving licence is accepted depends on your nationality and the licence you hold. Ask the rental company before you book.'}
          </P>
        </>
      ),
    },
    provenance(data, lang),
  ]
}

function bikeSections(data: VehicleHubData, lang: Lang): ArticleSection[] {
  const c = Object.fromEntries(data.cohorts.map((x) => [x.key, x.summary]))
  const vi = lang === 'vi'
  const day = vi ? 'ngày' : 'day'
  const month = vi ? 'tháng' : 'month'
  return [
    {
      id: vi ? 'xe-dang-cho-thue' : 'motorbikes-available-now',
      title: vi ? 'Xe máy đang cho thuê' : 'Motorbikes available now',
      body: <Grid data={data} lang={lang} />,
    },
    {
      id: vi ? 'gia-thue-xe-may' : 'what-it-costs',
      title: vi ? 'Thuê xe máy giá bao nhiêu' : 'What a motorbike costs to rent',
      body: (
        <>
          <P>{vi ? 'Thuê theo ngày:' : 'By the day:'}</P>
          <Ul>
            <li>{vi ? 'Tất cả xe' : 'All bikes'}: {summaryText(c['daily-all'], day, lang)}.</li>
            <li>{vi ? 'Xe ga (tự động)' : 'Automatic scooters'}: {summaryText(c['daily-automatic'], day, lang)}.</li>
            <li>{vi ? 'Xe số và xe côn tay' : 'Manual and semi-automatic'}: {summaryText(c['daily-manual'], day, lang)}.</li>
          </Ul>
          <P>{vi ? 'Thuê theo tháng:' : 'By the month:'}</P>
          <Ul>
            <li>{vi ? 'Tất cả xe' : 'All bikes'}: {summaryText(c['monthly-all'], month, lang)}.</li>
            <li>{vi ? 'Xe ga (tự động)' : 'Automatic scooters'}: {summaryText(c['monthly-automatic'], month, lang)}.</li>
            <li>{vi ? 'Xe số và xe côn tay' : 'Manual and semi-automatic'}: {summaryText(c['monthly-manual'], month, lang)}.</li>
          </Ul>
          <P>
            {vi
              ? 'Giá theo tháng không phải giá ngày nhân ba mươi: đó là giá riêng mà cửa hàng niêm yết cho thuê dài hạn. Tiền cọc, giấy tờ cần để lại và phí giao xe do từng cửa hàng quy định.'
              : 'A month price is not a day price times thirty: it is the separate long-term rate the shop lists. Deposit, the documents a shop keeps and any delivery fee are set by each shop.'}
          </P>
        </>
      ),
    },
    {
      id: vi ? 'chon-xe' : 'automatic-or-manual',
      title: vi ? 'Xe ga hay xe số, thuê ngày hay thuê tháng' : 'Automatic or manual, by the day or the month',
      body: (
        <Ul>
          <li>
            <HereLink href={explorer('motorbike', '&attr_transmission=automatic')}>{vi ? 'Xe ga' : 'Automatic scooters'}</HereLink>{' '}
            — {count(data.counts.automatic ?? 0, lang)} {vi ? 'xe; dễ đi nhất trong phố đông.' : 'listed; the easiest thing to ride in city traffic.'}
          </li>
          <li>
            <HereLink href={explorer('motorbike', '&attr_transmission=manual')}>{vi ? 'Xe số và côn tay' : 'Manual and semi-automatic bikes'}</HereLink>{' '}
            — {count(data.counts.manual ?? 0, lang)} {vi ? 'xe; hợp người đã quen xe và các chuyến đi xa.' : 'listed; for experienced riders and longer trips.'}
          </li>
          <li>
            <HereLink href={explorer('motorbike', '&attr_rentalPeriod=daily')}>{vi ? 'Thuê theo ngày' : 'Priced by the day'}</HereLink>{' '}
            — {count(data.counts.daily ?? 0, lang)} {vi ? 'xe' : 'bikes'};{' '}
            <HereLink href={explorer('motorbike', '&attr_rentalPeriod=monthly')}>{vi ? 'thuê theo tháng' : 'priced by the month'}</HereLink>{' '}
            — {count(data.counts.monthly ?? 0, lang)} {vi ? 'xe.' : 'bikes.'}
          </li>
        </Ul>
      ),
    },
    {
      id: vi ? 'dat-xe-the-nao' : 'how-booking-works',
      title: vi ? 'Đặt xe như thế nào' : 'How booking works',
      body: (
        <>
          <P>
            {hubBooking(hubCopy(data, lang))}
          </P>
          <P>
            {vi
              ? 'Giấy phép lái xe được chấp nhận tùy quốc tịch, loại giấy phép và dung tích xe. Hãy hỏi rõ cửa hàng trước khi thuê.'
              : 'Which licence is accepted depends on your nationality, the licence you hold and the size of the bike. Ask the shop before you rent.'}
          </P>
        </>
      ),
    },
    provenance(data, lang),
  ]
}

/** The inputs every piece of trust copy is built from: counts, not source names (vehicle-hub-copy.ts). */
function hubCopy(data: VehicleHubData, lang: Lang): HubCopyInput {
  return { kind: data.kind, lang, state: linkState(data.total, data.linked), n: count(data.total, lang), from: joinNames(referenceSources(data.sources), lang), site: SITE_NAME }
}

export function vehicleHubContent(data: VehicleHubData, lang: Lang, published: string): ArticleContent {
  const slug = VEHICLE_HUB_SLUGS[data.kind][lang]
  const other = VEHICLE_HUB_SLUGS[data.kind][lang === 'vi' ? 'en' : 'vi']
  const vi = lang === 'vi'
  const isCar = data.kind === 'car'
  const copy = hubCopy(data, lang)
  const intro = hubIntro(copy)
  const disclosure = hubDisclosure(copy)

  return {
    eyebrow: isCar ? (vi ? 'Thuê xe tự lái · TP.HCM' : 'Car hire · Ho Chi Minh City') : (vi ? 'Thuê xe máy · TP.HCM' : 'Motorbike hire · Ho Chi Minh City'),
    h1: isCar
      ? vi ? 'Thuê xe tự lái TP.HCM: giá thuê theo ngày theo từng loại xe' : 'Car rental in Ho Chi Minh City: self-drive cars and what a day costs'
      : vi ? 'Thuê xe máy Sài Gòn: xe ga, xe số, thuê theo ngày hoặc theo tháng' : 'Motorbike rental in Ho Chi Minh City: scooters by the day or the month',
    intro,
    canonical: `/${slug}`,
    published,
    // Ho Chi Minh City's calendar day, the same clock the printed "most recent change" uses (review, 2026-09-29).
    ...(data.lastChange ? { updated: hcmcIsoDate(data.lastChange) } : {}),
    lang,
    alternate: { lang: lang === 'vi' ? 'en' : 'vi', href: `/${other}` },
    ...(disclosure ? { disclosure } : {}),
    sections: isCar ? carSections(data, lang) : bikeSections(data, lang),
    related: marketplaceGuidesExcept(slug),
    // ⛔ EMPTY ON PURPOSE: no FAQPage JSON-LD (FAQ rich results ended 2026-05-07; see the header).
    faqs: [],
  }
}

export function VehicleHub({ data, lang, published }: { data: VehicleHubData; lang: Lang; published: string }) {
  return <SeoArticle content={vehicleHubContent(data, lang, published)} />
}

import { formatMoneyFull } from '@/lib/vnd'
import type { PriceSummary } from '@/lib/vehicle-hub-stats'
import type { VehicleHubData } from '@/lib/vehicle-hubs'

/**
 * The car-hire hub's meta description, answer first: what a day of self-drive hire costs, from the same cohorts the page
 * prints (vehicle-hub-stats.ts `carCohorts`: day prices only, a median and middle half from BAND_MIN rows, a low–high
 * range below that, nothing under RANGE_MIN). Owner 2026-11-22, "how to make it top ranked for ai": ChatGPT, asked "how
 * much do self-drive car rentals typically cost in Vietnam per day?", cited rental shops' own pages; this page has 40-odd
 * shops' day prices on one page and said only that it had "day prices by car size".
 *
 * ⚠️ `fallback` (the page's old wording) whenever the all-cars cohort has no figure, so the description never states a
 * price the page does not show. The 7-seat clause drops out on its own when that cohort has none.
 */
export function carHubDescription(data: VehicleHubData, lang: 'en' | 'vi', fallback: string): string {
  const cohort = (key: string) => data.cohorts.find((c) => c.key === key)?.summary
  const all = cohort('all')
  const seven = cohort('seats-7')
  const money = (n: number) => formatMoneyFull(n, '₫', lang)
  const count = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US').format(data.total)

  const allText = phrase(all, lang, money)
  if (!allText) return fallback
  const sevenText = phrase(seven, lang, money, true)

  if (lang === 'vi') {
    return `Thuê xe tự lái TP.HCM: ${allText}${sevenText ? `; xe 7 chỗ ${sevenText}` : ''}. ${count} xe từ các cửa hàng địa phương.`
  }
  return `Self-drive car hire in Ho Chi Minh City: ${allText}${sevenText ? `; 7-seaters ${sevenText}` : ''}. ${count} cars from local shops.`
}

/**
 * "about 900,000 đ a day (middle half 800,000 đ–1,000,000 đ)" · "800,000 đ–1,700,000 đ a day" · null — the page's own words
 * ("the middle half", "một nửa số xe"): p25–p75 is half the cars, never "most" of them (codex, diff review). `short` (the
 * 7-seat clause) drops the middle half and the unit the sentence already gave; two equal ends are printed once.
 */
function phrase(s: PriceSummary | undefined, lang: 'en' | 'vi', money: (n: number) => string, short = false): string | null {
  if (!s || s.kind === 'too-few') return null
  const span = (a: number, b: number) => (a === b ? money(a) : `${money(a)}–${money(b)}`)
  const unit = short ? '' : lang === 'vi' ? '/ngày' : ' a day'
  if (s.kind === 'range') return `${span(s.min, s.max)}${unit}`
  const middle = !short && s.p25 !== s.p75
  if (lang === 'vi') return `khoảng ${money(s.median)}${unit}${middle ? ` (một nửa số xe ${span(s.p25, s.p75)})` : ''}`
  return `about ${money(s.median)}${unit}${middle ? ` (middle half ${span(s.p25, s.p75)})` : ''}`
}

/**
 * The motorbike hub's meta description, a price first (OpenSEO audit 2026-11-26: every result above this page on Google's
 * first page for "thuê xe máy sài gòn" leads with one, "từ 50k/ngày"; this one named none). The lowest day price of the day
 * figures the page prints (vehicle-hub-stats.ts bikeCohorts `daily-all`: a range or band from RANGE_MIN bikes), so the
 * description never states a price the page does not show; `fallback` (the page's old wording) below that.
 * ⚠️ The Vietnamese one still opens with "Thuê xe máy Sài Gòn", the page's biggest search word for word (its page.tsx).
 */
export function bikeHubDescription(data: VehicleHubData, lang: 'en' | 'vi', fallback: string): string {
  const day = data.cohorts.find((c) => c.key === 'daily-all')?.summary
  if (!day || day.kind === 'too-few') return fallback
  // ⛔ ONLY A FIGURE THE DAY BLOCK PRINTS (commit-gate review, Opus): a range prints its low end, so "from" it; a band prints
  // its median and middle half, never its minimum, so "about" the median.
  const vi = lang === 'vi'
  const money = formatMoneyFull(day.kind === 'range' ? day.min : day.median, '₫', lang)
  const price = day.kind === 'range' ? (vi ? `từ ${money}/ngày` : `from ${money} a day`) : (vi ? `khoảng ${money}/ngày` : `about ${money} a day`)
  const n = new Intl.NumberFormat(vi ? 'vi-VN' : 'en-US').format(data.total)
  return vi
    ? `Thuê xe máy Sài Gòn (TP.HCM) ${price}: ${n} xe ga và xe số từ các cửa hàng, giá theo ngày và theo tháng từ các tin đang có.`
    : `Motorbike rental in Ho Chi Minh City (Saigon), ${price}: ${n} scooters and bikes from local shops, day and month prices from live listings.`
}

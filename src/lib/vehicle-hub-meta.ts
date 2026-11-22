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

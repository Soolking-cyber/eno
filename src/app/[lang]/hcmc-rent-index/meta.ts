import { SITE_NAME } from '@/lib/edition'
import { sentenceDescription, titleWithSite } from '@/lib/meta-description'
import { formatMoneyFull } from '@/lib/vnd'
import type { RentIndex } from '@/lib/rent-index'

/**
 * The rent index's <title> and description, in the words people ask in ("rent prices in Ho Chi Minh City by district") and
 * with the snapshot's own figures in the description — owner 2026-11-22, "how to make it top ranked for ai": a ChatGPT
 * check of "usual prices for long-term apartment rentals in Ho Chi Minh City" cited vietnamrenty ("Market Report H1
 * 2026"), leaseinvietnam ("Rent Prices in Ho Chi Minh City 2026: District Data Hub") and apartment.vn ("Apartment Rent
 * Prices in Ho Chi Minh City by Area"); Bing showed this page as "HCMC Rent Index · Giá thuê nhà TP.HCM theo quận",
 * half Vietnamese, with no figure and no date.
 *
 * ⚠️ ONE LANGUAGE PER VARIANT. The old single bilingual title predates the `/vi` twin: `/vi/hcmc-rent-index` is now its own
 * self-canonical URL (src/lib/lang-pinned.ts families), so Googlebot reads English at the plain URL and Vietnamese at
 * `/vi`, and each can carry its own words. Every other `lang` is a client-side machine translation of the English render.
 * ⚠️ FIGURES ONLY FROM A SNAPSHOT, and only medians the page itself prints (n ≥ MIN_CELL_N): a missing band drops out of the
 * sentence rather than showing a dash, and no snapshot gives the plain wording.
 */
export function rentIndexMeta(index: RentIndex | null, lang: string): { title: string; description: string } {
  const vi = lang === 'vi'
  const when = index ? new Date(index.computedAt) : null
  const ok = when && Number.isFinite(when.getTime()) ? when : null
  const hcmc = (locale: string, opts: Intl.DateTimeFormatOptions) =>
    ok!.toLocaleDateString(locale, { ...opts, timeZone: 'Asia/Ho_Chi_Minh' })
  const money = (v: number) => formatMoneyFull(v, '₫', vi ? 'vi' : 'en')
  const count = (v: number) => new Intl.NumberFormat(vi ? 'vi-VN' : 'en-US').format(v)

  if (vi) {
    const month = ok ? `, tháng ${hcmc('en-GB', { month: 'numeric' })}/${hcmc('en-GB', { year: 'numeric' })}` : ''
    const title = `Giá thuê nhà TP.HCM theo quận${month} | ${SITE_NAME}`
    const parts = index && ok ? figures(index, (b) => (b === 'br1' ? 'căn hộ 1 phòng ngủ' : '2 phòng ngủ'), money) : []
    const description =
      parts.length && ok
        ? `Giá thuê trung vị TP.HCM ngày ${hcmc('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })}: ${parts.join(', ')}/tháng. Từng quận, từ ${count(index!.used)} tin, cập nhật mỗi ngày.`
        : 'Giá thuê nhà trung vị theo quận tại TP.HCM: căn hộ, nhà nguyên căn và phòng, tính mỗi ngày từ tin đang đăng, được tự do trích dẫn.'
    // Within a result (Seobility crawl 4, 2026-11-25: /vi at 1,022 px of 1,000) — the figures' sentence stays whole.
    return { title, description: sentenceDescription(description) }
  }

  const month = ok ? `, ${hcmc('en-GB', { month: 'long', year: 'numeric' })}` : ''
  // The site's name only within 60 characters (Seobility, 2026-11-23: 64 with the month was over the ~580 px a result shows).
  const title = titleWithSite(`Ho Chi Minh City Rent Prices by District${month}`, SITE_NAME, 60)
  const parts = index && ok ? figures(index, (b) => (b === 'br1' ? '1-bedroom' : '2-bedroom'), money) : []
  const description =
    parts.length && ok
      ? `Median asking rent in Ho Chi Minh City, ${hcmc('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}: ${parts.join(', ')} a month. By district, from ${count(index!.used)} listings, updated daily.`
      : 'Median asking rent by district in Ho Chi Minh City for apartments, houses and rooms, recalculated every day from live listings and free to cite.'
  return { title, description: sentenceDescription(description) }
}

/** "1-bedroom 8,000,000 đ", "2-bedroom 9,700,000 đ" — the bands with a published median, in that order. */
function figures(index: RentIndex, label: (b: 'br1' | 'br2') => string, money: (v: number) => string): string[] {
  return (['br1', 'br2'] as const).flatMap((b) => {
    const m = index.cityBands[b]?.median
    return m != null && m > 0 ? [`${label(b)} ${money(m)}`] : []
  })
}

import { VI_OVERRIDES } from '@/generated/vi-overrides'

/**
 * The /hcmc-rent-index FAQ as data — what its FAQPage JSON-LD is built from. page.tsx renders the same strings as
 * literal `<Tr>`s (and one `<Bilingual>`) so scripts/gen-ui-strings.mjs harvests them; Google penalises structured
 * data that does not match the visible page, so hcmc-rent-index.test.ts holds the two to the same words.
 * ⚠️ HERE, NOT IN page.tsx, ONLY SO A TEST CAN BUILD THE NODE: a Next page may export nothing but its own fields.
 *
 * ⚠️ PLAIN STATEMENTS WITH NO NUMBERS IN THEM, so each is one stable `<Tr>` key with curated
 * Vietnamese — and so the FAQPage JSON-LD can never quote a figure the table beside it no longer shows.
 * ⚠️ `aVi` IS AN ANSWER WRITTEN IN BOTH LANGUAGES, rendered as `<Bilingual>` rather than `<Tr>`: the third answer's
 * terms changed (owner decision 9 — the credit link is welcome and may be nofollow, no longer asked for), and a new
 * `<Tr>` key has no curated Vietnamese until vi-overrides is regenerated (rent-index-sections.tsx says why that run is
 * not made for one string). The JSON-LD reads `aVi` too, so both languages' structured data match their page.
 */
export const FAQS: readonly { q: string; a: string; aVi?: string }[] = [
  {
    q: 'How much is rent in Ho Chi Minh City?',
    a: 'It depends mostly on the type of home and the district. The figures at the top of this page are the city-wide medians of current asking rents for apartments, houses and rooms, and the table below them gives the same figures for each district, so you can compare any district with the city as a whole.',
  },
  {
    q: 'Are these the rents people actually pay?',
    a: 'No — they are asking prices from live listings. Signed rents are often lower after negotiation, and a long lease or paying several months up front usually earns a discount. Use the index to compare districts and spot an outlier, not as a quote.',
  },
  {
    q: 'Can I use this data in an article or report?',
    a: 'Yes. The figures are free to cite and quote. Please credit eno.vn; a link to https://eno.vn/hcmc-rent-index is welcome and may be nofollow. The full table is available as a CSV download, with the snapshot time on every row.',
    aVi: 'Có. Các số liệu được tự do trích dẫn. Vui lòng ghi nguồn eno.vn; chúng tôi hoan nghênh liên kết đến https://eno.vn/hcmc-rent-index, kể cả liên kết nofollow. Toàn bộ bảng có thể tải về dưới dạng CSV, mỗi dòng đều ghi thời điểm số liệu.',
  },
]

/** The FAQ as the reader sees it — the same curated Vietnamese `<Tr>` renders, so the JSON-LD matches the page. */
const inLang = (en: string, lang: string) => (lang === 'vi' ? VI_OVERRIDES[en] ?? en : en)
/** An answer as the reader sees it: its own Vietnamese when it was written in both languages (`aVi`), else `inLang`. */
const answerIn = (f: { a: string; aVi?: string }, lang: string) => (lang === 'vi' && f.aVi ? f.aVi : inLang(f.a, lang))

/** The FAQPage node in the page's language (en or vi — the only two the server renders). */
export function faqPageJsonLd(lang: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: inLang(f.q, lang),
      acceptedAnswer: { '@type': 'Answer', text: answerIn(f, lang) },
    })),
  }
}

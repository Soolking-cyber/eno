/**
 * The four rent tools (owner, 2026-11-23: "all web tools if they make sense for us"): small calculators at the site root,
 * English at /<slug> and Vietnamese at /vi/<slug> (a phase-1 `/vi` family — src/lib/lang-pinned.ts lists the same four
 * slugs as a literal pattern for the proxy bundle, and lang-pinned.test.ts holds the two equal).
 * MARKETPLACE ONLY, like the rent index they link to: the services build answers 404, and only eno.vn submits them.
 * ⚠️ ONE LIST FOR EVERY PLACE THAT NAMES THEM — the guides hubs' Tools section, the sitemap, llms.txt, the reserved
 * seller handles and each tool's links to the others — so a fifth tool is added in one edit.
 */
export const RENT_TOOL_SLUGS = [
  'rent-affordability-calculator',
  'move-in-cost-calculator',
  'rental-cost-comparison',
  'vietnamese-price-converter',
] as const

export type RentToolSlug = (typeof RENT_TOOL_SLUGS)[number]

type Copy = { en: string; vi: string }

export const RENT_TOOLS: Record<RentToolSlug, { label: Copy; blurb: Copy }> = {
  'rent-affordability-calculator': {
    label: { en: 'Rent affordability calculator', vi: 'Tính tiền thuê nhà so với thu nhập' },
    blurb: { en: 'Rent as a share of your take-home pay, and what is left each month.', vi: 'Tiền thuê chiếm bao nhiêu phần trăm thu nhập thực nhận, và mỗi tháng còn lại bao nhiêu.' },
  },
  'move-in-cost-calculator': {
    label: { en: 'Move-in cost calculator', vi: 'Tính tiền cần có khi ký hợp đồng thuê' },
    blurb: { en: 'Cash needed at signing: deposit, rent in advance, agent fee and setup costs.', vi: 'Số tiền phải chuẩn bị khi ký: tiền cọc, tiền thuê trả trước, phí môi giới và chi phí ban đầu.' },
  },
  'rental-cost-comparison': {
    label: { en: 'Rental cost comparison', vi: 'So sánh chi phí thuê nhà' },
    blurb: { en: 'Two or three homes compared over the whole lease, bills and commute included.', vi: 'So sánh hai hoặc ba căn trong suốt thời hạn thuê, tính cả phí, điện nước và đi lại.' },
  },
  'vietnamese-price-converter': {
    label: { en: 'Vietnamese price converter', vi: 'Đổi giá viết tắt ra số tiền' },
    blurb: { en: 'Read 15tr, 1,5 tỷ or 800k as an exact amount in đồng.', vi: 'Đọc 15tr, 1,5 tỷ hay 800k thành số đồng chính xác.' },
  },
}

/** The tool's address in a language: plain for English, the `/vi` twin for Vietnamese. */
export function rentToolPath(slug: RentToolSlug, lang: string): string {
  return lang === 'vi' ? `/vi/${slug}` : `/${slug}`
}

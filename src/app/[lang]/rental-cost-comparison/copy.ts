import type { Copy, FaqEntry } from '@/components/marketplace/rent-tool-page'

/**
 * /rental-cost-comparison's words, both languages authored (a sibling of page.tsx so tests can read them).
 * ⛔ THE DEPOSIT IS CASH TIED UP, NEVER A COST, AND ITS RETURN IS AN ASSUMPTION, NOT A PROMISE (owner's brief, 2026-11-23).
 * "Total cost" and "cash up front" stay two separate figures everywhere.
 */
// Seobility crawl 10: the English title was cut to "…Over a…" (past 570 px) and said "Cost" twice; the Vietnamese one's "giữa" was
// in no text on the page. Both now fit whole, in words the page uses.
export const META: { title: Copy; description: Copy } = {
  title: { en: 'Rental cost comparison: two or three homes over a lease', vi: 'So sánh tổng chi phí thuê của hai hoặc ba căn' },
  description: {
    en: 'Compare two or three rentals over your lease: rent, monthly fees, utilities and commute added up and ranked cheapest first, with the deposit shown apart.',
    vi: 'So sánh hai hoặc ba căn trong suốt thời hạn thuê: cộng tiền thuê, phí, điện nước và đi lại, xếp từ rẻ nhất, tiền cọc được tách riêng.',
  },
}

/** Three homes over 12 months, chosen so the lowest rent (C) is the dearest in total. page.test.tsx pins that. */
export const EXAMPLE = {
  months: 12,
  homes: [
    { rent: 9_000_000, deposit: 9_000_000, fees: 300_000, utilities: 1_200_000, commute: 1_500_000 },
    { rent: 10_500_000, deposit: 21_000_000, fees: 0, utilities: 1_000_000, commute: 300_000 },
    { rent: 8_000_000, deposit: 16_000_000, fees: 500_000, utilities: 1_500_000, commute: 2_500_000 },
  ],
} as const

/**
 * The homes' names, one authored pair per letter. ⛔ NOT A NAME BUILT FROM THE LETTER AT RUN TIME (gate round 2): the string
 * harvest cannot see a template literal, so the nine machine-translated languages printed "Home B" in English.
 */
export const HOMES: readonly Copy[] = [
  { en: 'Home A', vi: 'Căn A' },
  { en: 'Home B', vi: 'Căn B' },
  { en: 'Home C', vi: 'Căn C' },
]
export const HOME_C_OPTIONAL: Copy = { en: 'Home C (optional)', vi: 'Căn C (không bắt buộc)' }

export const INTRO: Copy = {
  en: 'Add each home’s rent, monthly fees, utilities and commute, then multiply by the months of the lease: that is its total cost. The deposit is kept apart, as cash tied up that is assumed to come back in full. In the example below, the home with the lowest rent costs the most over 12 months.',
  vi: 'Cộng tiền thuê, phí hằng tháng, điện nước và chi phí đi lại của mỗi căn rồi nhân với số tháng thuê: đó là tổng chi phí. Tiền cọc được tách riêng, là tiền bị giữ lại và giả định được trả đủ khi hết hợp đồng. Trong ví dụ dưới đây, căn có tiền thuê thấp nhất lại tốn nhiều nhất sau 12 tháng.',
}

export const FAQS: readonly FaqEntry[] = [
  {
    q: { en: 'Why is the deposit not in the total cost?', vi: 'Sao tiền cọc không nằm trong tổng chi phí?' },
    a: {
      en: 'A deposit is cash tied up, not spent: the comparison assumes it comes back in full at the end. That is an assumption, not a promise, so it is shown on its own, in the cash up front.',
      vi: 'Tiền cọc là tiền bị giữ lại chứ không phải tiền tiêu mất: phép so sánh giả định bạn được trả đủ khi hết hợp đồng. Đây chỉ là giả định, không phải cam kết, nên cọc được hiện riêng, trong tiền trả trước.',
    },
  },
  {
    q: { en: 'What should I enter as commute cost?', vi: 'Chi phí đi lại nên nhập thế nào?' },
    a: {
      en: 'What getting to work or school costs each month from that address: fuel, parking, ride-hailing or bus fares. A cheaper home further out can cost more once it is added.',
      vi: 'Chi phí đi làm, đi học mỗi tháng từ địa chỉ đó: xăng, gửi xe, xe công nghệ hay vé xe buýt. Căn rẻ hơn nhưng xa hơn có thể tốn hơn khi cộng khoản này.',
    },
  },
  {
    q: { en: 'How do I estimate utilities?', vi: 'Ước tính tiền điện nước thế nào?' },
    a: {
      en: 'Ask the landlord or the current tenant for recent bills, and ask how electricity and water are charged; the contract should say.',
      vi: 'Hãy hỏi chủ nhà hoặc người đang thuê về hóa đơn gần đây, và hỏi điện, nước được tính giá thế nào; hợp đồng nên ghi rõ.',
    },
  },
  {
    q: { en: 'Can I compare only two homes?', vi: 'Chỉ so sánh hai căn được không?' },
    a: { en: 'Yes. Leave the third home empty and it is left out.', vi: 'Được. Để trống căn thứ ba thì căn đó không được tính.' },
  },
]

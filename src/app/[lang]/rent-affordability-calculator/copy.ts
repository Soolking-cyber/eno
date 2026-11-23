import type { Copy, FaqEntry } from '@/components/marketplace/rent-tool-page'

/**
 * /rent-affordability-calculator's words, both languages authored. Here, not in page.tsx, so a test can read them:
 * a Next page may export only its own fields.
 * ⛔ 30% AND 40% ARE OPTIONAL BUDGETING RULES OF THUMB (owner's brief, 2026-11-23) — never a Vietnamese standard,
 * rule, law or "recommended" figure. Every line that names them says so.
 */
export const META: { title: Copy; description: Copy } = {
  title: { en: 'Rent Affordability Calculator: Rent as a Share of Income', vi: 'Tính tỷ lệ tiền thuê nhà trên thu nhập' },
  description: {
    en: 'Enter your take-home pay and rent to see the share of income rent takes, what is left each month, and how it compares with the 30% and 40% rules of thumb.',
    vi: 'Nhập thu nhập thực nhận và tiền thuê nhà để biết tiền thuê chiếm bao nhiêu phần trăm, mỗi tháng còn lại bao nhiêu và so với mốc tham khảo 30%, 40%.',
  },
}

/** The worked example: a take-home pay and a rent that land between the two marks, so the page shows both. */
export const EXAMPLE = { pay: 25_000_000, rent: 8_500_000 } as const

export const INTRO: Copy = {
  en: 'Divide the monthly rent by your monthly take-home pay: that is the share of your income the rent takes. On {pay} take-home pay, a rent of {rent} is {share}, leaving {left} a month. The 30% and 40% marks are optional budgeting rules of thumb, not a Vietnamese standard or rule.',
  vi: 'Lấy tiền thuê nhà mỗi tháng chia cho thu nhập thực nhận mỗi tháng là biết tiền thuê chiếm bao nhiêu phần trăm thu nhập. Với thu nhập thực nhận {pay}, tiền thuê {rent} chiếm {share}, mỗi tháng còn lại {left}. Mốc 30% và 40% chỉ là cách ước lượng ngân sách để tham khảo, không phải tiêu chuẩn hay quy định ở Việt Nam.',
}

export const FAQS: readonly FaqEntry[] = [
  {
    q: { en: 'Should I use gross pay or take-home pay?', vi: 'Nên tính theo lương gộp hay lương thực nhận?' },
    a: {
      en: 'Take-home pay: what reaches your account after personal income tax and insurance contributions. Rent is paid from that money, so a share of gross pay looks smaller than it is.',
      vi: 'Lương thực nhận, tức số tiền về tài khoản sau thuế thu nhập cá nhân và các khoản bảo hiểm. Tiền thuê được trả từ khoản này; tính theo lương gộp sẽ khiến tỷ lệ trông thấp hơn thực tế.',
    },
  },
  {
    q: { en: 'Is spending 30% of income on rent a rule in Vietnam?', vi: 'Ở Việt Nam có quy định tiền thuê nhà không quá 30% thu nhập không?' },
    a: {
      en: 'No. 30% and 40% are budgeting rules of thumb, not a law or a Vietnamese standard. They are shown only as reference points; what you can afford depends on your other costs.',
      vi: 'Không. 30% và 40% chỉ là mốc ước lượng khi lập ngân sách, không phải luật hay tiêu chuẩn ở Việt Nam. Công cụ đưa ra để bạn tham khảo; khả năng chi trả thực tế còn tùy các khoản chi khác.',
    },
  },
  {
    q: { en: 'Should fees and bills count as rent?', vi: 'Có nên tính cả phí và điện nước vào tiền thuê?' },
    a: {
      en: 'Enter what you pay the landlord each month. For the whole cost of a home, add management fees, parking and utilities to the rent, or use the rental cost comparison.',
      vi: 'Hãy nhập số tiền trả cho chủ nhà mỗi tháng. Muốn biết tổng chi phí của một căn, hãy cộng thêm phí quản lý, gửi xe và điện nước, hoặc dùng công cụ so sánh chi phí thuê nhà.',
    },
  },
  {
    q: { en: 'What if I share the rent?', vi: 'Nếu ở ghép thì tính thế nào?' },
    a: {
      en: 'Enter your own take-home pay and your share of the rent, or the household’s combined take-home pay and the full rent.',
      vi: 'Nhập thu nhập thực nhận của bạn và phần tiền thuê bạn trả, hoặc tổng thu nhập thực nhận của cả nhà và toàn bộ tiền thuê.',
    },
  },
]

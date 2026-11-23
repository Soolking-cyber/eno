import type { Copy, FaqEntry } from '@/components/marketplace/rent-tool-page'

/**
 * /move-in-cost-calculator's words, both languages authored (a sibling of page.tsx so tests can read them).
 * ⛔ NO CLAIM ABOUT WHAT IS "TYPICAL" IN VIETNAM (owner's brief, 2026-11-23): the defaults (1 month's deposit, 1 month in
 * advance, no fee) are only starting values, and the copy says to use what the contract states.
 * ⚠️ THE EXAMPLE'S MONTH COUNTS ARE TYPED INTO THE SENTENCES ("2 months", "1 month"): page.test.tsx holds them to EXAMPLE.
 */
export const META: { title: Copy; description: Copy } = {
  title: { en: 'Move-In Cost Calculator: Cash Needed at Signing', vi: 'Tính tiền cần có khi ký hợp đồng thuê nhà' },
  description: {
    en: 'Add up the cash a rental needs at signing (deposit, rent in advance, agent fee, setup costs) and the monthly rent after that, from your own contract figures.',
    vi: 'Cộng tiền cọc, tiền thuê trả trước, phí môi giới và chi phí ban đầu để biết cần bao nhiêu tiền khi ký hợp đồng thuê, và mỗi tháng sau đó trả bao nhiêu.',
  },
}

export const EXAMPLE = { rent: 12_000_000, depositMonths: 2, advanceMonths: 1, agentFee: 2_000_000, setup: 5_000_000 } as const

export const INTRO: Copy = {
  en: 'Cash needed at signing = deposit + rent paid in advance + agent fee + setup costs. For a {rent} home with 2 months’ deposit, 1 month paid in advance, a {fee} agent fee and {setup} of setup costs, that is {total}; after that the rent is {rent} a month, from month {first}. Use the figures your contract states.',
  vi: 'Tiền cần có khi ký = tiền cọc + tiền thuê trả trước + phí môi giới + chi phí ban đầu. Với căn {rent}/tháng, cọc 2 tháng, trả trước 1 tháng, phí môi giới {fee} và {setup} chi phí ban đầu, bạn cần {total} khi ký; sau đó mỗi tháng trả {rent}, bắt đầu từ tháng thứ {first}. Hãy dùng đúng con số ghi trong hợp đồng.',
}

export const FAQS: readonly FaqEntry[] = [
  {
    q: { en: 'Is the rent paid in advance counted twice?', vi: 'Tiền thuê trả trước có bị tính hai lần không?' },
    a: {
      en: 'No. It is part of the cash at signing and pays for the first months of the lease. The regular monthly rent starts from the first month not already paid.',
      vi: 'Không. Khoản này nằm trong số tiền cần có khi ký và dùng để trả cho những tháng đầu. Tiền thuê hằng tháng chỉ bắt đầu từ tháng đầu tiên chưa được trả trước.',
    },
  },
  {
    q: { en: 'How many months of deposit should I enter?', vi: 'Nên nhập bao nhiêu tháng tiền cọc?' },
    a: {
      en: 'The number your contract or offer states. Terms differ from one landlord to the next, so check the deposit, the advance and any fees in writing before you pay.',
      vi: 'Đúng số tháng ghi trong hợp đồng hoặc đã thỏa thuận với chủ nhà. Mỗi chủ nhà một điều kiện, nên hãy xem kỹ tiền cọc, tiền trả trước và các khoản phí trên giấy trước khi trả tiền.',
    },
  },
  {
    q: { en: 'Is the deposit a cost?', vi: 'Tiền cọc có phải là chi phí không?' },
    a: {
      en: 'It is cash you hand over, not money spent: it is meant to come back at the end of the lease, less any deductions the contract allows. It is still paid at signing, so it is in the total.',
      vi: 'Đó là tiền bạn giao ra chứ không phải tiền tiêu mất: tiền cọc được trả lại khi hết hợp đồng, trừ các khoản hợp đồng cho phép khấu trừ. Nhưng vẫn phải trả khi ký, nên được tính vào tổng.',
    },
  },
  {
    q: { en: 'What counts as setup costs?', vi: 'Chi phí ban đầu gồm những gì?' },
    a: {
      en: 'Whatever you pay once to move in that the landlord does not: internet installation, a moving van, basic furniture or kitchenware. Leave it empty if there is none.',
      vi: 'Những khoản trả một lần khi dọn vào mà chủ nhà không lo: lắp internet, thuê xe chuyển nhà, đồ đạc hay đồ bếp cơ bản. Không có thì để trống.',
    },
  },
]

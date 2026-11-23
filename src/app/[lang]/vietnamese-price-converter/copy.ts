import type { Copy, FaqEntry } from '@/components/marketplace/rent-tool-page'
import type { PriceRefusal } from '@/lib/rent-tools/vn-price'

/**
 * /vietnamese-price-converter's words, both languages authored (a sibling of page.tsx so tests can read them). The
 * Vietnamese questions are asked the way a Vietnamese reader asks them, not translated from the English ones; the
 * answers carry the same facts.
 * ⚠️ AMOUNTS ARE `{placeholders}` FILLED THROUGH vnd.ts (`faqs(money)`), so an English answer groups with commas and a
 * Vietnamese one with dots, and the FAQPage node matches the page in each.
 */
export const META: { title: Copy; description: Copy } = {
  title: { en: 'Vietnamese Price Converter: 15tr, 1,5 tỷ, 800k to Đồng', vi: 'Đổi giá viết tắt 15tr, 1,5 tỷ, 800k ra số tiền' },
  description: {
    en: 'Paste a Vietnamese price like 15tr, 1,5 tỷ, 800k or 15 triệu 500 and get the exact amount in đồng and how it reads. Anything that reads two ways is flagged.',
    vi: 'Dán giá viết tắt như 15tr, 1,5 tỷ, 800k hay 15 triệu 500 để đổi ra số đồng chính xác, kèm cách đọc bằng chữ. Số có thể hiểu hai cách sẽ được báo rõ.',
  },
}

/** The worked examples, read by the real parser on the server: six that read, two it refuses. */
export const EXAMPLES = ['15tr', '1,5 tỷ', '800k', '15 triệu 500', 'mười lăm triệu', '2 tỷ 3', '15tr50', '1.500 triệu'] as const

export const INTRO: Copy = {
  en: '15tr is {v15tr}: tr (triệu) means a million, k (nghìn) a thousand and tỷ a billion. Paste any price as Vietnamese listings write it, such as 1,5 tỷ, 800k, 15 triệu 500 or mười lăm triệu, to get the exact amount in đồng and how it reads. Anything that can be read two ways is refused, with both readings.',
  vi: 'Dán giá viết tắt như 15tr, 1,5 tỷ, 800k, 15 triệu 500 hay mười lăm triệu để đổi ra số đồng đầy đủ, kèm cách đọc bằng chữ, tiện khi ghi hợp đồng hay so giá. Ví dụ 15tr là {v15tr}. Số nào có thể hiểu theo hai cách, công cụ sẽ báo và nêu cả hai.',
}

/** The FAQ with its amounts in the page's grouping. */
export function faqs(money: (n: number) => string): FaqEntry[] {
  const values = {
    v15tr: money(15_000_000),
    v800k: money(800_000),
    v15ty: money(1_500_000_000),
    v15t500: money(15_500_000),
    v2t3: money(2_300_000_000),
  }
  return [
    {
      q: { en: 'What do tr, k and tỷ mean in a price?', vi: '15tr, 800k, 1,5 tỷ là bao nhiêu tiền?' },
      a: {
        en: 'tr is short for triệu, a million đồng: 15tr is {v15tr}. k means a thousand (800k is {v800k}) and tỷ a billion (1,5 tỷ is {v15ty}).',
        vi: 'tr là triệu: 15tr là {v15tr}. k là nghìn: 800k là {v800k}. tỷ là một nghìn triệu: 1,5 tỷ là {v15ty}.',
      },
      values,
    },
    {
      q: { en: 'What does 15 triệu 500 mean?', vi: '15 triệu 500, 2 tỷ 3 là bao nhiêu?' },
      a: {
        en: 'Digits after a unit continue the amount: 15 triệu 500 is {v15t500} and 2 tỷ 3 is {v2t3}. Two digits, as in 15tr50, can be read two ways, so the converter asks for 15tr500 or 15tr050.',
        vi: 'Chữ số sau đơn vị là phần nối tiếp: 15 triệu 500 là {v15t500}, 2 tỷ 3 là {v2t3}. Riêng hai chữ số như 15tr50 có thể hiểu hai cách, nên công cụ yêu cầu ghi 15tr500 hoặc 15tr050.',
      },
      values,
    },
    {
      q: { en: 'Why is a comma a decimal point in Vietnamese prices?', vi: 'Dấu chấm và dấu phẩy trong giá tiền khác nhau thế nào?' },
      a: {
        en: 'Vietnamese puts a dot between thousands and a comma before decimals, the reverse of English. So 1.500.000 đ is one and a half million, the same as 1,5 triệu; before a unit, 1,5 and 1.5 both mean one and a half.',
        vi: 'Tiếng Việt dùng dấu chấm để nhóm hàng nghìn và dấu phẩy trước phần thập phân, ngược với tiếng Anh: 1.500.000 đ là một triệu rưỡi, bằng 1,5 triệu. Đứng trước đơn vị, cả 1,5 và 1.5 đều là một phẩy năm.',
      },
      values,
    },
    {
      q: { en: 'How is the amount written in words?', vi: 'Số tiền viết bằng chữ thế nào?' },
      a: {
        en: 'In Vietnamese, as on a contract or a receipt: {v15t500} is “mười lăm triệu năm trăm nghìn đồng”. The converter writes nghìn and linh; ngàn and lẻ mean the same.',
        vi: 'Như khi ghi “bằng chữ” trên hợp đồng hay hóa đơn: {v15t500} là “mười lăm triệu năm trăm nghìn đồng”. Công cụ dùng “nghìn” và “linh”; “ngàn” và “lẻ” cũng cùng nghĩa.',
      },
      values,
    },
  ]
}

/**
 * Why an input was refused, in both languages. `{text}` is the reader's own input; `{a}` / `{b}` the two readings.
 * Shared by the live converter and the server-printed examples, so both say the same thing.
 */
export function refusalCopy(r: PriceRefusal): Copy {
  switch (r.code) {
    case 'empty': return { en: 'Paste or type a price, for example 15tr or 1,5 tỷ.', vi: 'Dán hoặc gõ một mức giá, ví dụ 15tr hoặc 1,5 tỷ.' }
    case 'negative': return { en: 'A price cannot be negative.', vi: 'Giá không thể là số âm.' }
    case 'zero': return { en: 'That reads as 0 đ. Enter an amount above 0.', vi: 'Số này bằng 0 đ. Hãy nhập số lớn hơn 0.' }
    case 'tooLarge': return { en: 'That is more than a million tỷ đồng, too large to be a price.', vi: 'Số này lớn hơn một triệu tỷ đồng, quá lớn để là một mức giá.' }
    case 'range': return { en: 'That looks like a range. Convert one amount at a time.', vi: 'Đây có vẻ là một khoảng giá. Hãy đổi từng số một.' }
    case 'unknownWord': return { en: 'Cannot read “{word}”. Use digits with k, tr or tỷ, or write the number in Vietnamese words with diacritics.', vi: 'Không đọc được “{word}”. Hãy dùng chữ số với k, tr hoặc tỷ, hoặc viết số bằng chữ tiếng Việt có dấu.' }
    case 'noUnit': return { en: '“{text}” has no unit, so it could be thousands, millions or billions. Add k, tr or tỷ.', vi: '“{text}” chưa có đơn vị nên có thể là nghìn, triệu hay tỷ. Hãy thêm k, tr hoặc tỷ.' }
    case 'decimalNoUnit': return { en: '“{text}” has a decimal but no unit. Add tr or tỷ.', vi: '“{text}” có phần thập phân nhưng chưa có đơn vị. Hãy thêm tr hoặc tỷ.' }
    case 'fraction': return { en: 'Đồng have no decimals. Write a whole amount.', vi: 'Tiền đồng không có phần lẻ. Hãy ghi số tròn.' }
    case 'ambiguousSeparator': return { en: 'Two readings: {a} if the separator groups thousands, or {b} if it is a decimal point. Write it without the separator, or with one or two decimals.', vi: 'Có hai cách hiểu: {a} nếu dấu là dấu nhóm hàng nghìn, hoặc {b} nếu là dấu thập phân. Hãy bỏ dấu, hoặc chỉ ghi một, hai chữ số thập phân.' }
    case 'ambiguousCurrency': return { en: 'Two readings: {a} if the last digits continue the unit, or {b} if they are đồng, as written. Write the full amount.', vi: 'Có hai cách hiểu: {a} nếu các chữ số cuối nối tiếp đơn vị, hoặc {b} nếu đó là số đồng như đã ghi. Hãy ghi đủ số tiền.' }
    case 'ambiguousTail': return { en: 'Two readings: {a} if the digits continue the unit, or {b} if they are the next unit. Write three digits after the unit, such as 500 or 050.', vi: 'Có hai cách hiểu: {a} nếu chữ số nối tiếp đơn vị, hoặc {b} nếu là đơn vị nhỏ hơn. Hãy ghi đủ ba chữ số sau đơn vị, như 500 hoặc 050.' }
    case 'unitOrder': return { en: 'The units are repeated or out of order. If there are two prices, convert one at a time.', vi: 'Đơn vị bị lặp hoặc sai thứ tự. Nếu có hai mức giá, hãy đổi từng số một.' }
    default: return { en: 'Cannot read that as one amount. Try 15tr, 1,5 tỷ, 800k or 15000000.', vi: 'Không đọc được thành một số tiền. Thử 15tr, 1,5 tỷ, 800k hoặc 15000000.' }
  }
}

/** The placeholders `refusalCopy` names, with the readings in the reader's grouping. */
export function refusalValues(r: PriceRefusal, money: (n: number) => string): Record<string, string> {
  if (r.code === 'unknownWord') return { word: r.word }
  if (r.code === 'noUnit' || r.code === 'decimalNoUnit') return { text: r.text }
  if (r.code === 'ambiguousSeparator' || r.code === 'ambiguousTail' || r.code === 'ambiguousCurrency') return { a: money(r.a), b: money(r.b) }
  return {}
}

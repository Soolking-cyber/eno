import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { parseVnPrice, vietnameseWords } from '@/lib/rent-tools/vn-price'
import { RENT_TOOLS } from '@/lib/rent-tools/registry'
import { Formula, Inputs, Limits, P, RentToolPage, T, rentToolMetadata } from '@/components/marketplace/rent-tool-page'
import { PriceConverter } from './calculator'
import { EXAMPLES, INTRO, META, faqs, refusalCopy, refusalValues } from './copy'

/**
 * /vietnamese-price-converter — "15tr", "1,5 tỷ", "800k", "15 triệu 500", "mười lăm triệu" as an exact amount in đồng.
 * The parser (src/lib/rent-tools/vn-price.ts) refuses what reads two ways rather than guessing; the examples below are
 * its own output, read on the server. MARKETPLACE ONLY.
 */
export const revalidate = 3600

const SLUG = 'vietnamese-price-converter'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return rentToolMetadata(SLUG, lang, META)
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const d = (n: number) => formatMoneyFull(n, '₫', moneyLocale(lang))
  const inWords = (n: number) => `${vietnameseWords(n)} đồng`
  const units = { k: d(1e3).replace(/\s?đ$/, ''), m: d(1e6).replace(/\s?đ$/, ''), b: d(1e9).replace(/\s?đ$/, ''), ty15: d(1_500_000_000) }

  return (
    <RentToolPage
      slug={SLUG}
      lang={lang}
      h1={RENT_TOOLS[SLUG].label}
      intro={INTRO}
      introValues={{ v15tr: d(15_000_000) }}
      calculator={<PriceConverter />}
      how={
        <>
          <Formula
            lines={[
              { c: { en: 'k, nghìn = × {k} · tr, triệu, củ = × {m} · tỷ = × {b}', vi: 'k, nghìn = × {k} · tr, triệu, củ = × {m} · tỷ = × {b}' }, values: units },
              { c: { en: 'A decimal before a unit: 1,5 tỷ = 1.5 × {b} = {ty15}', vi: 'Số thập phân trước đơn vị: 1,5 tỷ = 1,5 × {b} = {ty15}' }, values: units },
              { c: { en: 'Digits after a unit continue it: 2 tỷ 3 = 2.3 tỷ · 15 triệu 500 = 15.5 triệu', vi: 'Chữ số sau đơn vị là phần nối tiếp: 2 tỷ 3 = 2,3 tỷ · 15 triệu 500 = 15,5 triệu' } },
              { c: { en: 'No unit: the number is đồng, if it is at least {k}', vi: 'Không có đơn vị: là số đồng, nếu từ {k} trở lên' }, values: units },
            ]}
          />
          <Inputs
            items={[
              {
                term: { en: 'Price as written', vi: 'Giá cần đổi' },
                def: {
                  en: 'Digits with a unit (15tr, 800k, 1,5 tỷ), a full amount (15.000.000 or 15,000,000), or the number in Vietnamese words with diacritics (mười lăm triệu). A closing đ, VND or /tháng is ignored.',
                  vi: 'Chữ số kèm đơn vị (15tr, 800k, 1,5 tỷ), số đầy đủ (15.000.000 hoặc 15,000,000), hoặc số viết bằng chữ có dấu (mười lăm triệu). Chữ đ, VND hay /tháng ở cuối được bỏ qua.',
                },
              },
            ]}
          />
          <Limits
            items={[
              { en: 'Two digits right after a unit (15tr50), or three digits after a separator before a unit (1.500 triệu), can each mean two amounts, so they are refused.', vi: 'Hai chữ số ngay sau đơn vị (15tr50), hay ba chữ số sau dấu phân cách đứng trước đơn vị (1.500 triệu), đều có thể là hai số khác nhau nên bị từ chối.' },
              { en: 'm and b are not read as units, since they can mean metres or bytes.', vi: 'm và b không được hiểu là đơn vị, vì có thể là mét hay byte.' },
              { en: 'Number words need their diacritics: “nam” or “muoi” could be other words.', vi: 'Số viết bằng chữ cần có dấu: “nam” hay “muoi” có thể là từ khác.' },
              { en: 'One amount at a time: a range such as 15–20tr is refused.', vi: 'Mỗi lần một số: khoảng giá như 15–20tr sẽ bị từ chối.' },
            ]}
          />
        </>
      }
      example={
        <>
          <P c={{ en: 'The converter’s own readings of eight inputs, two of them refused:', vi: 'Cách công cụ đọc tám ví dụ, trong đó hai số bị từ chối:' }} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold"><T c={{ en: 'Written', vi: 'Viết' }} /></th>
                  <th scope="col" className="py-2 px-3 font-semibold"><T c={{ en: 'Amount', vi: 'Số tiền' }} /></th>
                  <th scope="col" className="py-2 pl-3 font-semibold"><T c={{ en: 'Reads', vi: 'Đọc là' }} /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {EXAMPLES.map((input) => {
                  const r = parseVnPrice(input)
                  return (
                    <tr key={input} className="align-top">
                      <th scope="row" lang="vi" className="py-2 pr-3 text-left font-semibold text-foreground">{input}</th>
                      {r.ok ? (
                        <>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-foreground">{d(r.vnd)}</td>
                          <td lang="vi" className="py-2 pl-3 text-body">{inWords(r.vnd)}</td>
                        </>
                      ) : (
                        <td colSpan={2} className="py-2 px-3 text-body">
                          <T c={refusalCopy(r.refusal)} values={refusalValues(r.refusal, d)} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      }
      faqs={faqs(d)}
      related={['rentals']}
    />
  )
}

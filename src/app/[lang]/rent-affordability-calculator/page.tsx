import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { affordability, percent } from '@/lib/rent-tools/calc'
import { RENT_TOOLS } from '@/lib/rent-tools/registry'
import { ExampleRows, Formula, Inputs, Limits, P, RentToolPage, rentToolMetadata } from '@/components/marketplace/rent-tool-page'
import { AffordabilityCalculator } from './calculator'
import { EXAMPLE, FAQS, INTRO, META } from './copy'

/**
 * /rent-affordability-calculator — rent as a share of take-home pay, what is left, and the 30% / 40% rules of thumb.
 * MARKETPLACE ONLY (src/lib/rent-tools/registry.ts): the services build answers 404. Static copy, so an hour's ISR like
 * the other content pages; the calculator is a client leaf and nothing typed into it leaves the browser.
 */
export const revalidate = 3600

const SLUG = 'rent-affordability-calculator'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return rentToolMetadata(SLUG, lang, META)
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const locale = moneyLocale(lang)
  const d = (n: number) => formatMoneyFull(n, '₫', locale)
  const ex = affordability(EXAMPLE.pay, EXAMPLE.rent)
  const share = percent(ex.share, locale)
  const values = { pay: d(EXAMPLE.pay), rent: d(EXAMPLE.rent), share, left: d(ex.left) }

  return (
    <RentToolPage
      slug={SLUG}
      lang={lang}
      h1={RENT_TOOLS[SLUG].label}
      intro={INTRO}
      introValues={values}
      calculator={<AffordabilityCalculator />}
      how={
        <>
          <Formula
            lines={[
              { c: { en: 'Share of income = rent ÷ take-home pay × 100%', vi: 'Tỷ lệ = tiền thuê ÷ thu nhập thực nhận × 100%' } },
              { c: { en: 'Left each month = take-home pay − rent', vi: 'Còn lại mỗi tháng = thu nhập thực nhận − tiền thuê' } },
              { c: { en: '30% mark = take-home pay × 0.3 · 40% mark = take-home pay × 0.4', vi: 'Mốc 30% = thu nhập thực nhận × 0,3 · mốc 40% = thu nhập thực nhận × 0,4' } },
            ]}
          />
          <Inputs
            items={[
              {
                term: { en: 'Monthly take-home pay', vi: 'Thu nhập thực nhận mỗi tháng' },
                def: { en: 'What reaches you each month after tax and insurance contributions. For a household, add up everyone’s.', vi: 'Số tiền thực sự về tay mỗi tháng, sau thuế và các khoản bảo hiểm. Tính cho cả nhà thì cộng thu nhập của mọi người.' },
              },
              {
                term: { en: 'Monthly rent', vi: 'Tiền thuê mỗi tháng' },
                def: { en: 'The rent in the contract or the offer. Add management fees or parking if you want them counted.', vi: 'Tiền thuê ghi trong hợp đồng hoặc giá chủ nhà đưa ra. Có thể cộng thêm phí quản lý, phí gửi xe nếu muốn tính cả.' },
              },
            ]}
          />
          <Limits
            items={[
              { en: '30% and 40% are budgeting rules of thumb, not a law or a Vietnamese standard.', vi: '30% và 40% chỉ là mốc ước lượng khi lập ngân sách, không phải luật hay tiêu chuẩn ở Việt Nam.' },
              { en: 'It does not know your other costs: food, transport, debts or savings.', vi: 'Công cụ không biết các khoản chi khác của bạn như ăn uống, đi lại, trả nợ hay tiết kiệm.' },
              { en: 'The result is an estimate from the figures you enter.', vi: 'Kết quả chỉ là ước tính từ số liệu bạn nhập.' },
            ]}
          />
        </>
      }
      example={
        <>
          <P c={{ en: 'A take-home pay of {pay} and a rent of {rent}:', vi: 'Thu nhập thực nhận {pay}, tiền thuê {rent}:' }} values={values} />
          <ExampleRows
            rows={[
              { label: { en: 'Share of income', vi: 'Tỷ lệ trên thu nhập' }, value: share, strong: true },
              { label: { en: 'Left each month', vi: 'Còn lại mỗi tháng' }, value: d(ex.left), strong: true },
              { label: { en: '30% of take-home pay', vi: '30% thu nhập thực nhận' }, value: d(ex.at30) },
              { label: { en: '40% of take-home pay', vi: '40% thu nhập thực nhận' }, value: d(ex.at40) },
            ]}
          />
          <P c={{ en: 'The rent is above the 30% mark and within the 40% mark.', vi: 'Tiền thuê vượt mốc 30% nhưng vẫn trong mốc 40%.' }} />
        </>
      }
      faqs={FAQS}
      related={['rentIndex', 'rentals']}
    />
  )
}

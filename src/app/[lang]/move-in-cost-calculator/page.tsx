import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { moveInCost } from '@/lib/rent-tools/calc'
import { RENT_TOOLS } from '@/lib/rent-tools/registry'
import { ExampleRows, Formula, Inputs, Limits, P, RentToolPage, rentToolMetadata } from '@/components/marketplace/rent-tool-page'
import { MoveInCalculator } from './calculator'
import { EXAMPLE, FAQS, INTRO, META } from './copy'

/**
 * /move-in-cost-calculator — the cash a rental needs at signing, and the regular rent after it. The rent paid in advance
 * is counted once: in the cash at signing, which pays the first months (moveInCost). MARKETPLACE ONLY.
 */
export const revalidate = 3600

const SLUG = 'move-in-cost-calculator'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return rentToolMetadata(SLUG, lang, META)
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const d = (n: number) => formatMoneyFull(n, '₫', moneyLocale(lang))
  const ex = moveInCost(EXAMPLE)
  const values = { rent: d(EXAMPLE.rent), fee: d(EXAMPLE.agentFee), setup: d(EXAMPLE.setup), total: d(ex.atSigning), first: String(ex.firstMonthDue) }

  return (
    <RentToolPage
      slug={SLUG}
      lang={lang}
      h1={RENT_TOOLS[SLUG].label}
      intro={INTRO}
      introValues={values}
      calculator={<MoveInCalculator />}
      how={
        <>
          <Formula
            lines={[
              { c: { en: 'Deposit = rent × months of deposit', vi: 'Tiền cọc = tiền thuê × số tháng cọc' } },
              { c: { en: 'Rent in advance = rent × months paid in advance', vi: 'Tiền thuê trả trước = tiền thuê × số tháng trả trước' } },
              { c: { en: 'Cash at signing = deposit + rent in advance + agent fee + setup costs', vi: 'Tiền cần có khi ký = tiền cọc + tiền thuê trả trước + phí môi giới + chi phí ban đầu' } },
              { c: { en: 'Each month after = rent, from the first month not paid in advance', vi: 'Hằng tháng sau đó = tiền thuê, từ tháng đầu tiên chưa trả trước' } },
            ]}
          />
          <Inputs
            items={[
              { term: { en: 'Monthly rent', vi: 'Tiền thuê mỗi tháng' }, def: { en: 'The rent in the contract.', vi: 'Tiền thuê ghi trong hợp đồng.' } },
              {
                term: { en: 'Deposit (months of rent)', vi: 'Tiền cọc (số tháng tiền thuê)' },
                def: { en: 'How many months of rent the contract holds as a deposit: 0 if none, halves allowed.', vi: 'Hợp đồng giữ bao nhiêu tháng tiền thuê làm tiền cọc: không cọc thì nhập 0, có thể nhập nửa tháng.' },
              },
              {
                term: { en: 'Months paid in advance', vi: 'Số tháng trả trước' },
                def: { en: 'Months of rent paid at signing. They cover the first months of the lease.', vi: 'Số tháng tiền thuê trả ngay khi ký, dùng cho những tháng đầu của hợp đồng.' },
              },
              { term: { en: 'Agent fee', vi: 'Phí môi giới' }, def: { en: 'What you pay an agent or broker yourself, in đồng.', vi: 'Khoản bạn tự trả cho người môi giới, tính bằng đồng.' } },
              {
                term: { en: 'Setup costs', vi: 'Chi phí ban đầu' },
                def: { en: 'One-off costs of moving in, such as internet installation or a moving van. Your own estimate.', vi: 'Các khoản chi một lần khi dọn vào, như lắp internet hay thuê xe chuyển nhà. Bạn tự ước tính.' },
              },
            ]}
          />
          <Limits
            items={[
              { en: 'It assumes nothing about what is usual: enter what your contract or offer says.', vi: 'Công cụ không giả định mức nào là phổ biến: hãy nhập theo hợp đồng hoặc thỏa thuận với chủ nhà.' },
              { en: 'Utilities, management fees and parking are not included; the rental cost comparison counts them.', vi: 'Chưa tính điện nước, phí quản lý và gửi xe; công cụ so sánh chi phí thuê nhà có tính các khoản này.' },
              { en: 'The result is an estimate from the figures you enter.', vi: 'Kết quả chỉ là ước tính từ số liệu bạn nhập.' },
            ]}
          />
        </>
      }
      example={
        <>
          <P c={{ en: 'A {rent} home, 2 months’ deposit, 1 month in advance, a {fee} agent fee and {setup} of setup costs:', vi: 'Căn {rent}/tháng, cọc 2 tháng, trả trước 1 tháng, phí môi giới {fee}, chi phí ban đầu {setup}:' }} values={values} />
          <ExampleRows
            rows={[
              { label: { en: 'Deposit: {rent} × 2', vi: 'Tiền cọc: {rent} × 2' }, values, value: d(ex.deposit) },
              { label: { en: 'Rent in advance: {rent} × 1', vi: 'Tiền thuê trả trước: {rent} × 1' }, values, value: d(ex.advance) },
              { label: { en: 'Agent fee', vi: 'Phí môi giới' }, value: d(ex.agentFee) },
              { label: { en: 'Setup costs', vi: 'Chi phí ban đầu' }, value: d(ex.setup) },
              { label: { en: 'Cash at signing', vi: 'Tiền cần có khi ký' }, value: d(ex.atSigning), strong: true },
              { label: { en: 'Each month from month {first}', vi: 'Mỗi tháng, từ tháng thứ {first}' }, values, value: d(ex.monthly), strong: true },
            ]}
          />
          <P c={{ en: 'Month 1 is already paid by the rent in advance, so it is not counted again.', vi: 'Tháng thứ nhất đã được trả bằng tiền thuê trả trước, nên không tính lại.' }} />
        </>
      }
      faqs={FAQS}
      related={['rentIndex', 'rentals']}
    />
  )
}

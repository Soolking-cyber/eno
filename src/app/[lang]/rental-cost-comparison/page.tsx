import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { compareRentals } from '@/lib/rent-tools/calc'
import { RENT_TOOLS } from '@/lib/rent-tools/registry'
import { Formula, Inputs, Limits, P, RentToolPage, T, rentToolMetadata } from '@/components/marketplace/rent-tool-page'
import { ComparisonCalculator } from './calculator'
import { EXAMPLE, FAQS, HOMES, INTRO, META } from './copy'

/**
 * /rental-cost-comparison — two or three homes over one lease, ranked by total cost. The deposit is never in the total:
 * it is cash up front, assumed (not promised) to come back. MARKETPLACE ONLY.
 */
export const revalidate = 3600

const SLUG = 'rental-cost-comparison'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return rentToolMetadata(SLUG, lang, META)
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const d = (n: number) => formatMoneyFull(n, '₫', moneyLocale(lang))
  const homes = EXAMPLE.homes.map((h, i) => ({ ...h, index: i }))
  const ranked = compareRentals(EXAMPLE.homes, EXAMPLE.months)
  const byIndex = Object.fromEntries(ranked.map((r) => [r.index, r]))
  const rows: { label: { en: string; vi: string }; get: (i: number) => number; strong?: boolean }[] = [
    { label: { en: 'Rent', vi: 'Tiền thuê' }, get: (i) => homes[i].rent },
    { label: { en: 'Monthly fees', vi: 'Phí hằng tháng' }, get: (i) => homes[i].fees },
    { label: { en: 'Utilities', vi: 'Điện nước' }, get: (i) => homes[i].utilities },
    { label: { en: 'Commute', vi: 'Đi lại' }, get: (i) => homes[i].commute },
    { label: { en: 'Per month', vi: 'Mỗi tháng' }, get: (i) => byIndex[i].perMonth, strong: true },
    { label: { en: 'Total over 12 months', vi: 'Tổng 12 tháng' }, get: (i) => byIndex[i].total, strong: true },
    { label: { en: 'Deposit (cash tied up)', vi: 'Tiền cọc (tiền bị giữ)' }, get: (i) => homes[i].deposit },
    { label: { en: 'Cash up front', vi: 'Tiền trả trước khi vào ở' }, get: (i) => byIndex[i].upFront },
  ]
  return (
    <RentToolPage
      slug={SLUG}
      lang={lang}
      h1={RENT_TOOLS[SLUG].label}
      intro={INTRO}
      calculator={<ComparisonCalculator />}
      how={
        <>
          <Formula
            lines={[
              { c: { en: 'Per month = rent + monthly fees + utilities + commute', vi: 'Mỗi tháng = tiền thuê + phí hằng tháng + điện nước + đi lại' } },
              { c: { en: 'Total cost = per month × months of the lease', vi: 'Tổng chi phí = mỗi tháng × số tháng thuê' } },
              { c: { en: 'Cash up front = deposit + the first month’s rent', vi: 'Tiền trả trước khi vào ở = tiền cọc + tiền thuê tháng đầu' } },
              { c: { en: 'Ranked by total cost, cheapest first', vi: 'Xếp theo tổng chi phí, rẻ nhất trước' } },
            ]}
          />
          <Inputs
            items={[
              { term: { en: 'Lease length (months)', vi: 'Thời hạn thuê (tháng)' }, def: { en: 'How long you expect to stay, 1 to 60 months.', vi: 'Bạn dự định ở bao lâu, từ 1 đến 60 tháng.' } },
              { term: { en: 'Monthly rent', vi: 'Tiền thuê mỗi tháng' }, def: { en: 'The rent in the contract or the offer.', vi: 'Tiền thuê ghi trong hợp đồng hoặc giá chủ nhà đưa ra.' } },
              {
                term: { en: 'Deposit', vi: 'Tiền cọc' },
                def: { en: 'The deposit in đồng. Not counted as a cost: it is assumed to come back in full at the end.', vi: 'Tiền cọc tính bằng đồng. Không tính vào chi phí: giả định được trả đủ khi hết hợp đồng.' },
              },
              { term: { en: 'Monthly fees', vi: 'Phí hằng tháng' }, def: { en: 'Management fee, parking and anything else billed every month besides rent.', vi: 'Phí quản lý, gửi xe và các khoản khác thu hằng tháng ngoài tiền thuê.' } },
              { term: { en: 'Utilities (estimate)', vi: 'Điện nước (ước tính)' }, def: { en: 'Electricity, water and internet in an ordinary month.', vi: 'Tiền điện, nước, internet của một tháng bình thường.' } },
              { term: { en: 'Commute', vi: 'Chi phí đi lại' }, def: { en: 'What getting to work or school costs each month from that address.', vi: 'Chi phí đi làm hoặc đi học mỗi tháng từ địa chỉ đó.' } },
            ]}
          />
          <Limits
            items={[
              { en: 'The deposit is assumed to be returned in full. That is an assumption, not a promise: deductions for damage or for leaving early come out of it.', vi: 'Giả định tiền cọc được trả đủ. Đây chỉ là giả định, không phải cam kết: tiền hư hỏng hay phạt trả nhà sớm sẽ bị trừ vào cọc.' },
              { en: 'Every figure is taken as the same each month: no change of rent during the lease, and no one-off costs such as agent fees.', vi: 'Mọi khoản được coi là giữ nguyên mỗi tháng: không đổi giá thuê trong thời hạn thuê, và chưa tính các khoản một lần như phí môi giới.' },
              { en: 'The result is an estimate from the figures you enter.', vi: 'Kết quả chỉ là ước tính từ số liệu bạn nhập.' },
            ]}
          />
        </>
      }
      example={
        <>
          <P c={{ en: 'Three homes over a 12-month lease:', vi: 'Ba căn, thuê 12 tháng:' }} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold"><span className="sr-only"><T c={{ en: 'Cost', vi: 'Khoản' }} /></span></th>
                  {homes.map((h) => <th key={h.index} scope="col" className="py-2 pl-3 text-right font-semibold"><T c={HOMES[h.index]} /></th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, k) => (
                  <tr key={k}>
                    <th scope="row" className={`py-2 pr-3 text-left ${r.strong ? 'font-bold text-foreground' : 'font-normal text-body'}`}><T c={r.label} /></th>
                    {homes.map((h) => <td key={h.index} className={`py-2 pl-3 text-right ${r.strong ? 'font-bold text-foreground' : 'text-foreground'}`}>{d(r.get(h.index))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The ranking as a list, each home's name its own authored pair (HOMES), so a machine-translated reader gets it
              translated too — a name filled into one sentence as a value never was (gate round 2). */}
          <P c={{ en: 'Cheapest first, over the 12 months:', vi: 'Từ rẻ nhất, sau 12 tháng:' }} />
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-base leading-relaxed text-body">
            {ranked.map((r) => (
              <li key={r.index}>
                <span className="font-bold text-foreground"><T c={HOMES[r.index]} /></span> · {d(r.total)}
                {r.overCheapest > 0 && <> · <T c={{ en: '{d} more', vi: 'nhiều hơn {d}' }} values={{ d: d(r.overCheapest) }} /></>}
              </li>
            ))}
          </ol>
          <P c={{ en: 'The deposits are not in these totals.', vi: 'Tiền cọc không nằm trong các tổng này.' }} />
        </>
      }
      faqs={FAQS}
      related={['rentIndex', 'rentals']}
    />
  )
}

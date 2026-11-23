'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { Fieldset } from '@/components/ui/fieldset'
import { MoneyField, MonthsField, ResultWell, useWaitingLine } from '@/components/marketplace/rent-tool-fields'
import { MAX_MONTHLY_VND, MAX_ONE_OFF_VND, compareRentals, readMoney, readMonths, type Field, type RentalOption } from '@/lib/rent-tools/calc'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

const LETTERS = ['A', 'B', 'C'] as const
const KEYS = ['rent', 'deposit', 'fees', 'utilities', 'commute'] as const
type Key = (typeof KEYS)[number]
type Home = Record<Key, string>
const EMPTY: Home = { rent: '', deposit: '', fees: '', utilities: '', commute: '' }

/** One home's fields as read: rent is required, the rest are 0 when empty. A home with every field empty is not compared. */
function readHome(h: Home): { blank: boolean; fields: Record<Key, Field<number>> } {
  return {
    blank: KEYS.every((k) => h[k].trim() === ''),
    fields: {
      rent: readMoney(h.rent, { max: MAX_MONTHLY_VND }),
      deposit: readMoney(h.deposit, { optional: true, max: MAX_ONE_OFF_VND }),
      fees: readMoney(h.fees, { optional: true, max: MAX_MONTHLY_VND }),
      utilities: readMoney(h.utilities, { optional: true, max: MAX_MONTHLY_VND }),
      commute: readMoney(h.commute, { optional: true, max: MAX_MONTHLY_VND }),
    },
  }
}

export function ComparisonCalculator() {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const d = (n: number) => formatMoneyFull(n, '₫', locale)
  const [months, setMonths] = useState('12')
  const [homes, setHomes] = useState<Home[]>([EMPTY, EMPTY, EMPTY])
  const [left, setLeft] = useState<Record<string, boolean>>({})
  const leave = (k: string) => () => setLeft((s) => ({ ...s, [k]: true }))
  const set = (i: number, k: Key) => (v: string) => setHomes((hs) => hs.map((h, j) => (j === i ? { ...h, [k]: v } : h)))

  const monthsR = readMonths(months, { min: 1, max: 60 })
  const read = homes.map(readHome)
  const label = (i: number) => fillBilingual(tr('Home {x}', 'Căn {x}'), 'Home {x}', { x: LETTERS[i] })
  const LABELS: Record<Key, string> = {
    rent: tr('Monthly rent', 'Tiền thuê mỗi tháng'),
    deposit: tr('Deposit', 'Tiền cọc'),
    fees: tr('Monthly fees', 'Phí hằng tháng'),
    utilities: tr('Utilities (estimate)', 'Điện nước (ước tính)'),
    commute: tr('Commute per month', 'Đi lại mỗi tháng'),
  }

  // The first two homes are always compared; the third only once something is typed into it.
  const used = read.map((r, i) => i < 2 || !r.blank)
  const waiting = useWaitingLine()
  const monthsLabel = tr('Lease length (months)', 'Thời hạn thuê (tháng)')
  const ready = monthsR.ok && read.every((r, i) => !used[i] || KEYS.every((k) => r.fields[k].ok))
  const options: { option: RentalOption; at: number }[] = ready
    ? read.flatMap((r, i) => (used[i] ? [{ option: Object.fromEntries(KEYS.map((k) => [k, (r.fields[k] as { value: number }).value])) as RentalOption, at: i }] : []))
    : []
  const ranked = ready && monthsR.ok ? compareRentals(options.map((o) => o.option), monthsR.value).map((r) => ({ ...r, at: options[r.index].at })) : []

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={tr('Rental cost comparison', 'So sánh chi phí thuê nhà')}>
      <div className="max-w-[12rem]">
        <MonthsField id="rc-months" label={monthsLabel} value={months} onChange={setMonths} read={monthsR} shown={!!left.months || months.trim() !== ''} onLeave={leave('months')} />
      </div>
      <div className="mt-6 grid gap-8 md:grid-cols-3 md:gap-6">
        {homes.map((h, i) => (
          <Fieldset key={i} legend={i === 2 ? `${label(i)} ${tr('(optional)', '(không bắt buộc)')}` : label(i)} legendClassName="text-base font-bold" className="space-y-4">
            {KEYS.map((k) => {
              const id = `rc-${LETTERS[i].toLowerCase()}-${k}`
              return (
                <MoneyField
                  key={k}
                  id={id}
                  label={LABELS[k]}
                  value={h[k]}
                  onChange={set(i, k)}
                  read={read[i].fields[k]}
                  // A started third home says at once that it still needs its rent.
                  shown={used[i] && (!!left[id] || h[k].trim() !== '' || (i === 2 && k === 'rent'))}
                  onLeave={leave(id)}
                />
              )
            })}
          </Fieldset>
        ))}
      </div>
      <ResultWell>
        {ranked.length ? (
          <ol className="divide-y divide-border">
            {ranked.map((r, n) => (
              <li key={r.at} className="py-3 first:pt-0 last:pb-0">
                <p className="text-base text-foreground">
                  <span className="font-bold">{n + 1}. {label(r.at)}</span>
                  {n > 0 && <span className="text-body"> · {fillBilingual(tr('{d} more', 'nhiều hơn {d}'), '{d} more', { d: d(r.overCheapest) })}</span>}
                </p>
                <p className="mt-0.5 text-t-price text-foreground">
                  {fillBilingual(tr('{total} over {n} months', '{total} trong {n} tháng'), '{total} over {n} months', { total: d(r.total), n: String(monthsR.ok ? monthsR.value : 0) })}
                </p>
                <p className="text-base text-body">
                  {fillBilingual(tr('{m} a month · cash up front {u}, of which deposit {dep} (assumed returned)', '{m} mỗi tháng · trả trước khi vào ở {u}, trong đó cọc {dep} (giả định được trả lại)'), '{m} a month · cash up front {u}, of which deposit {dep} (assumed returned)', { m: d(r.perMonth), u: d(r.upFront), dep: d(r.deposit) })}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-base text-body">
            {waiting(tr('Enter the lease length and at least the rent of two homes to compare them.', 'Nhập thời hạn thuê và ít nhất tiền thuê của hai căn để so sánh.'), [
              { label: monthsLabel, read: monthsR, empty: months.trim() === '' },
              ...read.flatMap((r, i) => (used[i] ? KEYS.map((k) => ({ label: `${label(i)}: ${LABELS[k]}`, read: r.fields[k], empty: i < 2 && k === 'rent' && homes[i][k].trim() === '' })) : [])),
            ])}
          </p>
        )}
      </ResultWell>
    </form>
  )
}

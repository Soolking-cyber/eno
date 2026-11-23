'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { MoneyField, MonthsField, ResultWell, useWaitingLine } from '@/components/marketplace/rent-tool-fields'
import { MAX_MONTHLY_VND, MAX_ONE_OFF_VND, moveInCost, readMoney, readMonths } from '@/lib/rent-tools/calc'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/**
 * The live move-in calculator. Starting values: 1 month's deposit, 1 month in advance, no agent fee — starting values
 * only, not a claim about what is usual (the page says to use the contract's figures).
 */
export function MoveInCalculator() {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const d = (n: number) => formatMoneyFull(n, '₫', locale)
  const num = (n: number) => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(n)
  const months = (n: number) =>
    n === 1 ? fillBilingual(tr('{n} month', '{n} tháng'), '{n} month', { n: num(n) }) : fillBilingual(tr('{n} months', '{n} tháng'), '{n} months', { n: num(n) })
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('1')
  const [advance, setAdvance] = useState('1')
  const [fee, setFee] = useState('0')
  const [setup, setSetup] = useState('')
  const [left, setLeft] = useState<Record<string, boolean>>({})
  const leave = (k: string) => () => setLeft((s) => ({ ...s, [k]: true }))
  const shown = (k: string, v: string) => !!left[k] || v.trim() !== ''

  const rentR = readMoney(rent, { max: MAX_MONTHLY_VND })
  const depositR = readMonths(deposit, { min: 0, max: 12, halves: true })
  const advanceR = readMonths(advance, { min: 0, max: 24 })
  const feeR = readMoney(fee, { optional: true, max: MAX_ONE_OFF_VND })
  const setupR = readMoney(setup, { optional: true, max: MAX_ONE_OFF_VND })
  const waiting = useWaitingLine()
  const LABELS = {
    rent: tr('Monthly rent', 'Tiền thuê mỗi tháng'),
    deposit: tr('Deposit (months of rent)', 'Tiền cọc (số tháng tiền thuê)'),
    advance: tr('Months paid in advance', 'Số tháng trả trước'),
    fee: tr('Agent fee', 'Phí môi giới'),
    setup: tr('Setup costs (optional)', 'Chi phí ban đầu (không bắt buộc)'),
  }
  const r = rentR.ok && depositR.ok && advanceR.ok && feeR.ok && setupR.ok
    ? moveInCost({ rent: rentR.value, depositMonths: depositR.value, advanceMonths: advanceR.value, agentFee: feeR.value, setup: setupR.value })
    : null

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={tr('Move-in cost calculator', 'Tính tiền cần có khi ký hợp đồng thuê')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField id="mi-rent" label={LABELS.rent} value={rent} onChange={setRent} read={rentR} shown={shown('rent', rent)} onLeave={leave('rent')} />
        <MonthsField id="mi-deposit" label={LABELS.deposit} value={deposit} onChange={setDeposit} read={depositR} shown={shown('deposit', deposit)} onLeave={leave('deposit')} halves />
        <MonthsField id="mi-advance" label={LABELS.advance} value={advance} onChange={setAdvance} read={advanceR} shown={shown('advance', advance)} onLeave={leave('advance')} />
        <MoneyField id="mi-fee" label={LABELS.fee} value={fee} onChange={setFee} read={feeR} shown={shown('fee', fee)} onLeave={leave('fee')} />
        <MoneyField id="mi-setup" label={LABELS.setup} value={setup} onChange={setSetup} read={setupR} shown={shown('setup', setup)} onLeave={leave('setup')} />
      </div>
      <ResultWell>
        {r ? (
          <>
            <p className="text-base text-body">{tr('Cash needed at signing', 'Tiền cần có khi ký')}</p>
            <p className="text-t-figure text-foreground">{d(r.atSigning)}</p>
            <dl className="mt-3 grid gap-1 text-base">
              {([
                [`${tr('Deposit', 'Tiền cọc')} (${months(depositR.ok ? depositR.value : 0)})`, r.deposit],
                [`${tr('Rent in advance', 'Tiền thuê trả trước')} (${months(advanceR.ok ? advanceR.value : 0)})`, r.advance],
                [tr('Agent fee', 'Phí môi giới'), r.agentFee],
                [tr('Setup costs', 'Chi phí ban đầu'), r.setup],
              ] as const).map(([label, v]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-body">{label}</dt>
                  <dd className="text-foreground">{d(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-base font-semibold text-foreground">
              {fillBilingual(tr('Then {rent} a month, from month {first}.', 'Sau đó {rent} mỗi tháng, từ tháng thứ {first}.'), 'Then {rent} a month, from month {first}.', { rent: d(r.monthly), first: num(r.firstMonthDue) })}
            </p>
          </>
        ) : (
          <p className="text-base text-body">
            {/* Only an empty rent asks for the rent: any other field that does not read is named. */}
            {waiting(tr('Enter the monthly rent to see the cash needed at signing.', 'Nhập tiền thuê mỗi tháng để xem số tiền cần có khi ký.'), [
              { label: LABELS.rent, read: rentR, empty: rent.trim() === '' },
              { label: LABELS.deposit, read: depositR, empty: false },
              { label: LABELS.advance, read: advanceR, empty: false },
              { label: LABELS.fee, read: feeR, empty: false },
              { label: LABELS.setup, read: setupR, empty: false },
            ])}
          </p>
        )}
      </ResultWell>
    </form>
  )
}

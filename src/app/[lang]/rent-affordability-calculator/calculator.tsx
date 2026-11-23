'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { MoneyField, ResultWell, useFieldPhase, useWaitingLine } from '@/components/marketplace/rent-tool-fields'
import { MAX_MONTHLY_VND, affordability, percent, readMoney } from '@/lib/rent-tools/calc'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/** The live calculator. Empty fields wait quietly; the result appears once both figures read. */
export function AffordabilityCalculator() {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const d = (n: number) => formatMoneyFull(n, '₫', locale)
  const [pay, setPay] = useState('')
  const [rent, setRent] = useState('')
  const phase = useFieldPhase()
  const payR = readMoney(pay, { max: MAX_MONTHLY_VND })
  const rentR = readMoney(rent, { max: MAX_MONTHLY_VND })
  const r = payR.ok && rentR.ok ? affordability(payR.value, rentR.value) : null
  const waiting = useWaitingLine()
  const payLabel = tr('Monthly take-home pay', 'Thu nhập thực nhận mỗi tháng')
  const rentLabel = tr('Monthly rent', 'Tiền thuê mỗi tháng')

  const band = r && {
    upTo30: tr('Within the 30% rule of thumb.', 'Nằm trong mốc tham khảo 30%.'),
    upTo40: tr('Above the 30% rule of thumb, within 40%.', 'Vượt mốc 30%, vẫn trong mốc 40%.'),
    over40: tr('Above both the 30% and 40% rules of thumb.', 'Vượt cả hai mốc tham khảo 30% và 40%.'),
    overPay: tr('The rent is more than your take-home pay.', 'Tiền thuê cao hơn thu nhập thực nhận.'),
  }[r.band]

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={tr('Rent affordability calculator', 'Tính tiền thuê nhà so với thu nhập')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          id="ra-pay"
          label={payLabel}
          value={pay}
          onChange={setPay}
          read={payR}
          shown={phase.shown('ra-pay')}
          onEnter={phase.onEnter('ra-pay')}
          onLeave={phase.onLeave('ra-pay')}
        />
        <MoneyField
          id="ra-rent"
          label={rentLabel}
          value={rent}
          onChange={setRent}
          read={rentR}
          shown={phase.shown('ra-rent')}
          onEnter={phase.onEnter('ra-rent')}
          onLeave={phase.onLeave('ra-rent')}
        />
      </div>
      <ResultWell>
        {r ? (
          <>
            <p className="text-t-figure text-foreground">{percent(r.share, locale)}</p>
            <p className="text-base text-body">{tr('of your take-home pay goes on rent', 'thu nhập thực nhận dành cho tiền thuê')}</p>
            <dl className="mt-3 grid gap-1 text-base">
              <div className="flex justify-between gap-4">
                <dt className="text-body">{r.left >= 0 ? tr('Left each month', 'Còn lại mỗi tháng') : tr('Short each month', 'Thiếu mỗi tháng')}</dt>
                <dd className="font-bold text-foreground">{d(Math.abs(r.left))}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body">{tr('30% of take-home pay', '30% thu nhập thực nhận')}</dt>
                <dd className="text-foreground">{d(r.at30)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body">{tr('40% of take-home pay', '40% thu nhập thực nhận')}</dt>
                <dd className="text-foreground">{d(r.at40)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-base font-semibold text-foreground">{band}</p>
          </>
        ) : (
          <p className="text-base text-body">
            {waiting(tr('Enter your take-home pay and the rent to see the result.', 'Nhập thu nhập thực nhận và tiền thuê để xem kết quả.'), [
              { label: payLabel, read: payR, empty: pay.trim() === '', shown: phase.shown('ra-pay') },
              { label: rentLabel, read: rentR, empty: rent.trim() === '', shown: phase.shown('ra-rent') },
            ])}
          </p>
        )}
      </ResultWell>
    </form>
  )
}

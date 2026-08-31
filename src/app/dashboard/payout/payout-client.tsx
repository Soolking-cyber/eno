'use client'

import { useEffect, useId, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldControl, FieldError, FieldDescription } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from '@/components/ui/icons'

/**
 * THE SELLER-FACING HALF OF VIETQR.
 *
 * ⛔ THE ACCOUNT NUMBER IS WRITE-ONLY FROM HERE. The GET returns whether payouts are configured and
 * the LAST FOUR digits — never the number — so this form starts empty even when details exist, and
 * a saved account is described rather than re-displayed. A seller re-entering it to change it is a
 * small cost; a stolen session reading out where someone's money goes is not.
 *
 * ⚠️ VALIDATED THE SAME WAY THE QR BUILDER VALIDATES. A six-digit BIN and a digits-only account are
 * what NAPAS requires, and the API checks the identical shapes — this is the copy that tells a
 * seller WHY, before they save something the checkout would then refuse to draw a code from.
 */

type State = {
  configured: boolean
  bankBin: string | null
  accountLast4: string | null
  bankAccountName: string | null
}

export function PayoutClient() {
  const { tr } = useLanguage()
  const errId = useId()

  const [loaded, setLoaded] = useState(false)
  const [current, setCurrent] = useState<State | null>(null)
  // ⚠️ DISTINGUISHED FROM "no details yet". A reviewer noted that a signed-out visitor or an
  // account with no shop got the same empty form as a seller who simply had not filled it in — and
  // then saw "check the numbers" when the save failed for a reason that had nothing to do with the
  // numbers. A 401 or 404 from the GET is a different situation and gets a different page.
  const [blocked, setBlocked] = useState<'signed_out' | 'no_shop' | null>(null)
  const [bankBin, setBankBin] = useState('')
  const [accountNo, setAccountNo] = useState('')
  const [holder, setHolder] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ⚠️ CLEARED ON THE NEXT KEYSTROKE. A reviewer spotted "Saved" persisting while a seller typed a
  // NEW account number — a green tick over unsaved changes, on the one form where believing your
  // edit landed and being wrong means money goes to the old account.
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/seller/payout', { cache: 'no-store' })
      .then(async (r) => {
        if (!alive) return null
        // ⚠️ 401 AND 404 ARE DIFFERENT PROBLEMS WITH DIFFERENT ANSWERS. Collapsing them told a
        // signed-out visitor they had no shop and sent them off to post a listing — a reviewer
        // caught it. One needs to sign in; the other needs to open a shop.
        if (r.status === 401) { setBlocked('signed_out'); return null }
        if (r.status === 404) { setBlocked('no_shop'); return null }
        return r.ok ? ((await r.json()) as State) : null
      })
      .then((d: State | null) => {
        if (!alive) return
        setCurrent(d)
        // ⚠️ THE HOLDER NAME IS PREFILLED AND THE ACCOUNT IS NOT. The name is not the secret and
        // retyping it is pure friction; the number is, so it starts blank every time.
        if (d?.bankAccountName) setHolder(d.bankAccountName)
        if (d?.bankBin) setBankBin(d.bankBin)
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const binOk = /^\d{6}$/.test(bankBin.trim())
  const accountOk = /^\d{4,19}$/.test(accountNo.trim())
  const holderOk = holder.trim().length >= 2
  const ready = binOk && accountOk && holderOk

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/seller/payout', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bankBin: bankBin.trim(),
          bankAccountNo: accountNo.trim(),
          bankAccountName: holder.trim(),
        }),
      })
      if (!res.ok) {
        setError(tr('That did not save. Check the numbers and try again.', 'Chưa lưu được. Vui lòng kiểm tra lại số và thử lại.'))
        return
      }
      setSaved(true)
      // ⚠️ THE ACCOUNT FIELD IS CLEARED ON SUCCESS, not left populated. It is write-only by design,
      // and leaving it on screen after saving quietly undoes that.
      setAccountNo('')
      setCurrent({
        configured: true,
        bankBin: bankBin.trim(),
        accountLast4: accountNo.trim().slice(-4),
        bankAccountName: holder.trim(),
      })
    } catch {
      setError(tr('Could not reach the server.', 'Không kết nối được máy chủ.'))
    } finally {
      setSaving(false)
    }
  }

  if (loaded && blocked) {
    return (
      <main className="mx-auto max-w-lg px-3 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {blocked === 'signed_out'
                ? tr('Please sign in', 'Vui lòng đăng nhập')
                : tr('No shop yet', 'Chưa có gian hàng')}
            </CardTitle>
            <CardDescription>
              {blocked === 'signed_out'
                ? tr('Sign in to set up how you get paid.', 'Đăng nhập để thiết lập cách nhận thanh toán.')
                : tr(
                    'Payout details belong to a shop. Post a listing first and this page will be here.',
                    'Thông tin nhận tiền thuộc về gian hàng. Hãy đăng tin trước, rồi quay lại trang này.',
                  )}
            </CardDescription>
          </CardHeader>
          {blocked === 'signed_out' && (
            <CardContent>
              {/* ⚠️ `asChild`, NOT `render` — ui/button is the documented exception that bridges the two
                    conventions, and it is the only primitive in the tree that does. */}
              <Button variant="cta" asChild className="w-full">
                <a href={`/signin?next=${encodeURIComponent('/dashboard/payout')}`}>{tr('Sign in', 'Đăng nhập')}</a>
              </Button>
            </CardContent>
          )}
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-lg px-3 py-8 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{tr('Getting paid', 'Nhận thanh toán')}</CardTitle>
          <CardDescription>
            {tr(
              'Buyers in Vietnam pay by scanning a bank QR code. Tell us which account it should send money to.',
              'Người mua tại Việt Nam thanh toán bằng cách quét mã QR ngân hàng. Hãy cho biết tài khoản nhận tiền.',
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {loaded && current?.configured && (
            <p className="rounded-xl bg-tint p-3 text-sm">
              {tr(
                `Payouts go to the account ending ${current.accountLast4} (${current.bankAccountName}).`,
                `Tiền được chuyển vào tài khoản kết thúc bằng ${current.accountLast4} (${current.bankAccountName}).`,
              )}
            </p>
          )}

          <Field invalid={bankBin.length > 0 && !binOk}>
            <FieldLabel>{tr('Bank code', 'Mã ngân hàng')}</FieldLabel>
            <FieldControl
              render={<Input inputMode="numeric" placeholder="970415" autoComplete="off" />}
              value={bankBin}
              onChange={(e) => { setBankBin(e.target.value); setSaved(false) }}
            />
            <FieldDescription>
              {tr('The six-digit code for your bank, e.g. 970415 for VietinBank.', 'Mã sáu chữ số của ngân hàng, ví dụ 970415 cho VietinBank.')}
            </FieldDescription>
          </Field>

          <Field invalid={accountNo.length > 0 && !accountOk}>
            <FieldLabel>{tr('Account number', 'Số tài khoản')}</FieldLabel>
            <FieldControl
              // ⚠️ `autoComplete="off"` AND NOT A PASSWORD FIELD. A browser offering to remember a
              // bank account is not a feature here, and masking it would stop a seller checking
              // what they just typed — which is the one moment a typo is catchable.
              render={<Input inputMode="numeric" placeholder="0011001932418" autoComplete="off" />}
              value={accountNo}
              onChange={(e) => { setAccountNo(e.target.value); setSaved(false) }}
            />
            <FieldDescription>
              {current?.configured
                ? tr('Enter it again to change it. We never show a saved account number.', 'Nhập lại để thay đổi. Chúng tôi không bao giờ hiển thị lại số tài khoản đã lưu.')
                : tr('Digits only, no spaces or dashes.', 'Chỉ nhập chữ số, không có khoảng trắng hay dấu gạch.')}
            </FieldDescription>
          </Field>

          <Field invalid={holder.length > 0 && !holderOk}>
            <FieldLabel>{tr('Account holder name', 'Tên chủ tài khoản')}</FieldLabel>
            <FieldControl
              render={<Input placeholder="NGUYEN VAN A" autoComplete="off" />}
              value={holder}
              onChange={(e) => { setHolder(e.target.value); setSaved(false) }}
            />
            <FieldDescription>
              {tr(
                'Exactly as your bank has it — buyers see this name before they confirm.',
                'Chính xác như ngân hàng ghi — người mua sẽ thấy tên này trước khi xác nhận.',
              )}
            </FieldDescription>
          </Field>

          {error && (
            <FieldError id={errId} role="alert" className="font-semibold">
              {error}
            </FieldError>
          )}
          {saved && !error && (
            <p role="status" className="text-sm font-semibold text-brand">
              {tr('Saved. You can now be paid by QR.', 'Đã lưu. Bạn có thể nhận thanh toán bằng QR.')}
            </p>
          )}

          <Button variant="cta" disabled={!ready || saving} onClick={save} className="w-full">
            {saving && <Loader2 className="animate-spin" />}
            {tr('Save', 'Lưu')}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

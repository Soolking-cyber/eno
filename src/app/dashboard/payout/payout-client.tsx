'use client'

import { useEffect, useId, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldControl, FieldDescription } from '@/components/ui/field'
import { CustomSelect } from '@/components/marketplace/custom-select'
import { VN_BANKS, bankByBin } from '@/lib/payments/vn-banks'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from '@/components/ui/icons'

/**
 * THE SELLER-FACING HALF OF VIETQR.
 *
 *
 * ⛔ IT RENDERS NO `<main>` — `dashboard/layout.tsx` ALREADY OWNS ONE. This section mounts inside
 * `<main id="main" class="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">`, so nesting a second
 * one put a landmark inside a landmark (two `<main>`s on one page, which breaks the skip link and
 * every screen-reader's "jump to main") AND doubled the horizontal padding — worst on the narrow
 * screens this is meant to serve. Every sibling section returns a fragment for exactly this reason.
 * `max-w-lg` stays, as a self-imposed measure on a short form inside a wide container.
 *
 * ⚠️ `<SectionHeader>` IS THE MOBILE CHROME AND IT IS `lg:hidden`. On a phone a dashboard section is
 * a pushed screen and needs a back affordance; on desktop the nav rail is always visible and the
 * bar would be redundant, so it disappears rather than being restyled.
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
  /** From KYC for an individual, or the registered company name for a business. */
  suggestedName: string | null
  suggestedFrom: 'identity' | 'business' | null
}

/**
 * ⚠️ THE LABEL A SELLER RECOGNISES, WITH THE LEGAL NAME UNDER IT. "SCB" is what they call their
 * bank; "Ngân hàng TMCP Sài Gòn" is what tells it apart from "SaigonBank" (Ngân hàng TMCP Sài Gòn
 * Công Thương) two rows above — a different institution with a near-identical short name. Both
 * lines are searchable, which is why the second line exists at all rather than being cosmetic.
 */
const BANK_OPTIONS = VN_BANKS.map((b) => ({ value: b.bin, label: b.short, description: b.name }))

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
  // ⚠️ THE BIN IS THE STATE. It can be, now that the picker is a SELECT rather than a text field —
  // there is no half-typed intermediate value to represent, so the "text plus derived code" pair
  // this used to carry is gone along with the free-text input it existed for.
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
        // ⚠️ THE SAVED NAME WINS OVER THE SUGGESTION. A seller who already corrected it to match
        // their bank must not have that quietly overwritten by the registry spelling next visit.
        if (d?.bankAccountName) setHolder(d.bankAccountName)
        else if (d?.suggestedName) setHolder(d.suggestedName)
        // ⚠️ RESOLVED THROUGH THE BAKED LIST, NOT TRUSTED AS-IS. A saved BIN that is no longer a
        // listed bank leaves the field empty rather than selecting a row that does not exist.
        if (bankByBin(d?.bankBin)) setBankBin(d!.bankBin!)
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  // ⛔ A BANK IS CHOSEN FROM THE LIST, NEVER TYPED. An earlier version asked for the six-digit BIN
  // directly; a wrong one does not error, it makes a QR that scans and names a different bank.
  const binOk = /^\d{6}$/.test(bankBin)
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
          bankBin,
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
      // ⚠️ THE SUGGESTION IS CARRIED FORWARD, not dropped. Rebuilding the whole object after a save
      // would erase where the name came from, and the hint under the field would vanish on save.
      setCurrent((prev) => ({
        ...(prev ?? { suggestedName: null, suggestedFrom: null }),
        configured: true,
        bankBin,
        accountLast4: accountNo.trim().slice(-4),
        bankAccountName: holder.trim(),
      }))
    } catch {
      setError(tr('Could not reach the server.', 'Không kết nối được máy chủ.'))
    } finally {
      setSaving(false)
    }
  }

  if (loaded && blocked) {
    return (
      <>
      {/* Native stack-nav title bar (mobile only) — the same string the desktop heading uses. */}
      <SectionHeader title={tr('Getting paid', 'Nhận thanh toán')} />
      <div className="mx-auto max-w-lg">
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
        </div>
      </>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — the same string the desktop heading uses. */}
      <SectionHeader title={tr('Getting paid', 'Nhận thanh toán')} />
      <div className="mx-auto max-w-lg">
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

          <Field>
            <FieldLabel>{tr('Your bank', 'Ngân hàng của bạn')}</FieldLabel>
            {/**
              * ⛔ THE APP'S OWN DROPDOWN, NOT A SECOND ONE BUILT NEXT TO IT. This was a bespoke
              * `ui/combobox` whose search box was the ANCHOR FIELD, with the list detached below
              * it; every other picker in the app — the facet bar, the area filter, every ward
              * list — is a `CustomSelect`, which puts the search INSIDE the popup card. Owner,
              * 2026-08-31, holding the two side by side: "look at these 2 dropdowns are they
              * same?". They were not. This is the house one.
              * ⚠️ IT IS SEARCHABLE AUTOMATICALLY. `CustomSelect` switches to the type-to-filter
              * variant at `SEARCHABLE_FROM` (6) options on its own — 42 banks is far past it, so
              * there is deliberately no `searchable` prop here. Passing one would opt this call
              * site out of a rule the component exists to apply app-wide.
              * ⛔ A BANK IS PICKED, NEVER TYPED. The first version asked for the raw NAPAS BIN
              * with "e.g. 970415 for VietinBank" underneath — a number nobody knows about their
              * own bank, typed by hand, that routes money. A wrong one does not error: it makes a
              * QR that scans and pays a different institution.
              */}
            <CustomSelect
              label={tr('Your bank', 'Ngân hàng của bạn')}
              placeholder={tr('Choose your bank', 'Chọn ngân hàng của bạn')}
              options={BANK_OPTIONS}
              value={bankBin}
              onChange={(next) => { setBankBin(next); setSaved(false) }}
              /**
               * ⚠️ THE TRIGGER SHOWS THE SHORT NAME ONLY. Without this it would show the row's
               * full label; with the legal name as a second line that is already handled, but
               * being explicit keeps a 60-character bank name out of a field this narrow.
               */
              triggerLabel={bankByBin(bankBin)?.short}
              /**
               * ⚠️ RESTYLED TO THE `<Input>` FIELDS AROUND IT, NOT LEFT AS A FACET PILL.
               * `CustomSelect`'s defaults are tuned for the filter bar: a 48px target that turns
               * `bg-accent` (brand blue) once it holds a non-default value. In a form it sits
               * between two `<Input>`s whose default variant is `filled` — `bg-tint`, borderless,
               * 44px — so both the height and the selected-state colour are overridden here.
               * ⚠️ `rounded-xl` IS RESTATED ON PURPOSE. The trigger flattens to `rounded-none`
               * while open, which reads as a menu growing out of a facet pill; a form field
               * should keep its shape. The caller's class lands after that in the same `cn()`,
               * so tailwind-merge lets this win.
               */
              className="min-h-11 rounded-xl px-4 text-sm font-normal"
              activeClassName="bg-tint text-foreground"
              wrapperClassName="w-full"
            />
            <FieldDescription>
              {tr('Only banks that can receive a QR transfer are listed.', 'Chỉ liệt kê ngân hàng có thể nhận chuyển khoản QR.')}
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
              {/* ⚠️ THE SUGGESTION SAYS WHERE IT CAME FROM. A name that appears in a field by itself
                  invites a seller to assume it is authoritative — but the BANK is the authority on
                  what its own account is called, and a shortened company form or a transliterated
                  passport name will legitimately differ. Naming the source is what makes editing it
                  feel allowed. */}
              {current?.suggestedFrom === 'business'
                ? tr(
                    'Filled in from your registered company name — edit it if your bank has it differently.',
                    'Điền sẵn từ tên công ty đã đăng ký — hãy sửa nếu ngân hàng ghi khác.',
                  )
                : current?.suggestedFrom === 'identity'
                  ? tr(
                      'Filled in from your verified ID — edit it if your bank has it differently.',
                      'Điền sẵn từ giấy tờ đã xác minh — hãy sửa nếu ngân hàng ghi khác.',
                    )
                  : tr(
                      'Exactly as your bank has it — buyers see this name before they confirm.',
                      'Chính xác như ngân hàng ghi — người mua sẽ thấy tên này trước khi xác nhận.',
                    )}
            </FieldDescription>
          </Field>

          {/**
            * ⛔ A PLAIN <p role="alert">, NOT <FieldError> — AND THIS IS THE BUG THAT CRASHED THE
            * PAGE. `FieldError` wraps Base UI's `Field.Error`, which THROWS unless it is inside a
            * `Field.Root`; this one describes the whole form, so it had no Field to live in. The
            * failure only appeared once `error` was truthy — that is, only after a save had already
            * failed — so the page died at exactly the moment it needed to explain itself, and the
            * real reason was never shown. Found by previewing it, not by any test.
            * ⚠️ `role="alert"` IS KEPT BY HAND, because that is the half `FieldError` was providing:
            * a message that appears after focus has moved to the Save button is announced by
            * nothing otherwise.
            */}
          {error && (
            <p id={errId} role="alert" className="text-xs font-semibold text-destructive">
              {error}
            </p>
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
      </div>
    </>
  )
}

'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

// Self-serve account-type switch in dashboard Settings — onboarding promises "you
// can change this later", and this is the "later". POSTs to the existing
// /api/profile/account-type route (which creates/claims a Seller storefront for
// business). Flat layout (no box) to match the single-canvas design.
export function AccountTypeSwitcher({ isBusiness, businessName, onSaved }: { isBusiness: boolean; businessName: string | null; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(businessName || '')
  const [busy, setBusy] = useState(false)
  // `err` is FORM-level (announced via role="alert"); `nameErr` belongs to #business-name-input and is
  // wired to it by <Field>. They are separate because the individual branch renders NO input at all —
  // there is nothing to hang aria-describedby off, so everything there must stay form-level.
  const [err, setErr] = useState('')
  const [nameErr, setNameErr] = useState('')

  const target = isBusiness ? 'individual' : 'business'

  const submit = async () => {
    setErr(''); setNameErr('')
    setBusy(true)
    try {
      const res = await fetch('/api/profile/account-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: target, ...(target === 'business' ? { businessName: name.trim() } : {}) }),
      })
      if (res.ok) {
        setEditing(false)
        onSaved()
      } else {
        const j = await res.json().catch(() => ({}))
        // business_name_required can only arrive while the business-name input is on screen.
        if (j.error === 'business_name_required' && target === 'business') setNameErr(tr('Enter a business name.', 'Nhập tên doanh nghiệp.'))
        else setErr(tr('Could not update. Try again.', 'Không cập nhật được. Thử lại.'))
      }
    } catch {
      setErr(tr('Could not update. Try again.', 'Không cập nhật được. Thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">
        {isBusiness ? tr('Business account', 'Tài khoản doanh nghiệp') : tr('Individual account', 'Tài khoản cá nhân')}
      </p>

      {!editing ? (
        <Button
          variant="link"
          size="none"
          onClick={() => { setName(businessName || ''); setErr(''); setNameErr(''); setEditing(true) }}
          className="text-xs font-bold text-accent-foreground"
        >
          {isBusiness ? tr('Switch to individual', 'Chuyển sang cá nhân') : tr('Switch to business', 'Chuyển sang doanh nghiệp')}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="max-w-md space-y-1.5">
            {/* Switching TO business has a field, so its blurb is a FieldDescription (it lands in the
                input's aria-describedby alongside any error). Switching TO individual has NO control at
                all — the same copy there is plain prose, and a <Field> would have nothing to bind to. */}
            {target === 'business' ? (
              <Field invalid={!!nameErr} className="gap-1.5">
                <FieldLabel render={<Label />}>{tr('Business name', 'Tên doanh nghiệp')}</FieldLabel>
                <FieldControl id="business-name-input"
                  render={
                    <Input
                      id="business-name-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      placeholder={tr('Business name', 'Tên doanh nghiệp')}
                    />
                  }
                />
                <FieldDescription className="text-muted-foreground">
                  {tr('Switching to business adds a storefront, analytics and bulk upload.', 'Chuyển sang doanh nghiệp sẽ thêm gian hàng, phân tích và đăng hàng loạt.')}
                </FieldDescription>
                {nameErr && <FieldError className="font-semibold">{nameErr}</FieldError>}
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground">
                {tr('Switching to individual hides the business storefront tools.', 'Chuyển sang cá nhân sẽ ẩn các công cụ gian hàng doanh nghiệp.')}
              </p>
            )}
            {/* Whole-submit failure — belongs to no input, so it is ANNOUNCED, not described. */}
            {err && <p role="alert" className="text-xs font-semibold text-destructive">{err}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              disabled={busy || (target === 'business' && name.trim().length < 2)}
              className="gap-1.5 px-5 py-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Confirm', 'Xác nhận')}
            </Button>
            <Button
              variant="ghost"
              size="none"
              onClick={() => { setEditing(false); setErr(''); setNameErr('') }}
              className="px-3 py-2 font-bold text-body hover:bg-transparent hover:text-foreground"
            >
              {tr('Cancel', 'Hủy')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

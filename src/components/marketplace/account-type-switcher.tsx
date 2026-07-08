'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'

const FIELD = 'w-full max-w-md rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-brand/20 placeholder:text-ink-4'

// Self-serve account-type switch in dashboard Settings — onboarding promises "you
// can change this later", and this is the "later". POSTs to the existing
// /api/profile/account-type route (which creates/claims a Seller storefront for
// business). Flat layout (no box) to match the single-canvas design.
export function AccountTypeSwitcher({ isBusiness, businessName, onSaved }: { isBusiness: boolean; businessName: string | null; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(businessName || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const target = isBusiness ? 'individual' : 'business'

  const submit = async () => {
    setErr('')
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
        setErr(j.error === 'business_name_required' ? tr('Enter a business name.', 'Nhập tên doanh nghiệp.') : tr('Could not update. Try again.', 'Không cập nhật được. Thử lại.'))
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
        <button onClick={() => { setName(businessName || ''); setErr(''); setEditing(true) }} className="text-xs font-bold text-accent-foreground hover:underline cursor-pointer">
          {isBusiness ? tr('Switch to individual', 'Chuyển sang cá nhân') : tr('Switch to business', 'Chuyển sang doanh nghiệp')}
        </button>
      ) : (
        <div className="space-y-2">
          {target === 'business' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={tr('Business name', 'Tên doanh nghiệp')}
              className={FIELD}
            />
          )}
          <p className="max-w-md text-xs text-body">
            {target === 'business'
              ? tr('Switching to business adds a storefront, analytics and bulk upload.', 'Chuyển sang doanh nghiệp sẽ thêm gian hàng, phân tích và đăng hàng loạt.')
              : tr('Switching to individual hides the business storefront tools.', 'Chuyển sang cá nhân sẽ ẩn các công cụ gian hàng doanh nghiệp.')}
          </p>
          {err && <p className="text-xs font-semibold text-destructive">{err}</p>}
          <div className="flex items-center gap-3">
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              disabled={busy || (target === 'business' && name.trim().length < 2)}
              className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm transition-colors disabled:opacity-40 cursor-pointer"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Confirm', 'Xác nhận')}
            </Button>
            <button onClick={() => { setEditing(false); setErr('') }} className="text-sm font-bold text-body hover:text-foreground cursor-pointer">
              {tr('Cancel', 'Hủy')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

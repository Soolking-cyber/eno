'use client'

import { useState } from 'react'
import { Loader2, Building2, User } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

// Self-serve account-type switch in dashboard Settings — onboarding promises
// "you can change this later", and this is the "later". POSTs to the existing
// /api/profile/account-type route (which creates/claims a Seller storefront for
// business). Switching to business needs a business name.
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
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {isBusiness ? <Building2 className="h-4 w-4 text-accent-foreground" /> : <User className="h-4 w-4 text-accent-foreground" />}
        {isBusiness ? tr('Business account', 'Tài khoản doanh nghiệp') : tr('Individual account', 'Tài khoản cá nhân')}
      </div>

      {!editing ? (
        <button onClick={() => { setName(businessName || ''); setErr(''); setEditing(true) }} className="mt-2 text-xs font-bold text-accent-foreground hover:underline cursor-pointer">
          {isBusiness ? tr('Switch to individual', 'Chuyển sang cá nhân') : tr('Switch to business', 'Chuyển sang doanh nghiệp')}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          {target === 'business' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={tr('Business name', 'Tên doanh nghiệp')}
              className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
            />
          )}
          <p className="text-xs text-body">
            {target === 'business'
              ? tr('Switching to business adds a storefront, analytics and bulk upload.', 'Chuyển sang doanh nghiệp sẽ thêm gian hàng, phân tích và đăng hàng loạt.')
              : tr('Switching to individual hides the business storefront tools.', 'Chuyển sang cá nhân sẽ ẩn các công cụ gian hàng doanh nghiệp.')}
          </p>
          {err && <p className="text-xs font-semibold text-red-500">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || (target === 'business' && name.trim().length < 2)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a66c2] px-4 py-2 text-xs font-bold text-white hover:bg-[#004182] disabled:opacity-40 cursor-pointer"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {tr('Confirm', 'Xác nhận')}
            </button>
            <button onClick={() => { setEditing(false); setErr('') }} className="rounded-xl px-4 py-2 text-xs font-bold text-body hover:bg-muted cursor-pointer">
              {tr('Cancel', 'Hủy')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

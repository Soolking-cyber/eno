'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Plus, LocateFixed } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn, getInitials } from '@/lib/utils'
import { compressImageFile } from '@/lib/normalize-image'

type Seller = { id: string; name: string; bio: string | null; location: string | null; avatarUrl: string | null; phone: string | null; legalName?: string | null; legalAddress?: string | null; idNumber?: string | null; taxCode?: string | null }

/** Inline business-profile editor (business tier). Edits the storefront's
 *  name/about/location/logo via the owner-scoped PATCH /api/seller. */
export function BusinessProfileEditor({ seller, repName, onSaved }: { seller: Seller; repName: string | null; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [name, setName] = useState(seller.name)
  const [rep, setRep] = useState(repName || '')
  const [bio, setBio] = useState(seller.bio || '')
  const [location, setLocation] = useState(seller.location || '')
  const [phone, setPhone] = useState(seller.phone || '')
  const [avatarUrl, setAvatarUrl] = useState(seller.avatarUrl)
  // Legal identity (Đ.29 e-commerce law collection duty; owner-only, never public)
  const [legalName, setLegalName] = useState(seller.legalName || '')
  const [legalAddress, setLegalAddress] = useState(seller.legalAddress || '')
  const [idNumber, setIdNumber] = useState(seller.idNumber || '')
  const [taxCode, setTaxCode] = useState(seller.taxCode || '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')

  // One-tap: fill Location from the device's GPS via reverse-geocoding.
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(`/api/reverse-geocode?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`)
          const d = await r.json()
          const addr = d.address || [d.ward, d.province].filter(Boolean).join(', ')
          if (addr) setLocation(addr)
        } catch { /* keep manual value */ } finally { setLocating(false) }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  // Re-sync local fields when the saved storefront changes (e.g. after refresh()
  // returns the server-trimmed values) so the form doesn't read perpetually dirty.
  useEffect(() => {
    setName(seller.name); setBio(seller.bio || ''); setLocation(seller.location || ''); setPhone(seller.phone || ''); setAvatarUrl(seller.avatarUrl)
    setLegalName(seller.legalName || ''); setLegalAddress(seller.legalAddress || ''); setIdNumber(seller.idNumber || ''); setTaxCode(seller.taxCode || '')
  }, [seller.name, seller.bio, seller.location, seller.phone, seller.avatarUrl, seller.legalName, seller.legalAddress, seller.idNumber, seller.taxCode])
  useEffect(() => { setRep(repName || '') }, [repName])

  const dirty = name !== seller.name || rep !== (repName || '') || bio !== (seller.bio || '') || location !== (seller.location || '') || phone !== (seller.phone || '') || avatarUrl !== seller.avatarUrl || legalName !== (seller.legalName || '') || legalAddress !== (seller.legalAddress || '') || idNumber !== (seller.idNumber || '') || taxCode !== (seller.taxCode || '')

  const uploadLogo = async (file: File) => {
    setUploading(true); setError('')
    try {
      file = await compressImageFile(file) // HEIC→JPEG + downscale so big photos don't 413
      const form = new FormData()
      form.append('files', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json()
      if (d.urls?.[0]) setAvatarUrl(d.urls[0])
      else throw new Error('upload')
    } catch { setError(tr('Logo upload failed.', 'Tải logo thất bại.')) } finally { setUploading(false) }
  }

  const save = async () => {
    setSaving(true); setError(''); setSaved(false)
    try {
      // The representative's name lives on the Profile (one business → many staff,
      // each their own account), saved alongside the storefront fields.
      if (rep.trim() && rep.trim() !== (repName || '')) {
        await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: rep.trim() }) })
      }
      // Only send avatarUrl when it changed — re-sending an unchanged non-bucket
      // logo URL would 400 (the API only accepts Supabase-hosted images).
      const payload: Record<string, unknown> = { name: name.trim(), bio, location, phone, legalName, legalAddress, idNumber, taxCode }
      if (avatarUrl !== seller.avatarUrl) payload.avatarUrl = avatarUrl
      const res = await fetch('/api/seller', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          d.error === 'no_phone_in_profile' ? tr("Phone numbers aren't allowed in the name/about.", 'Không ghi số trong tên/giới thiệu.')
          : d.error === 'phone_taken' ? tr('That phone is already used by another storefront.', 'Số này đã được dùng cho gian hàng khác.')
          : d.error === 'bad_phone' ? tr('Enter a valid phone number.', 'Nhập số điện thoại hợp lệ.')
          : d.error === 'bad_id_number' ? tr('ID/ERC number should be 9–13 digits.', 'Số CCCD/ĐKDN gồm 9–13 chữ số.')
          : d.error === 'bad_tax_code' ? tr('Tax code format: 10 digits (or 10-3 with branch).', 'Mã số thuế: 10 chữ số (hoặc 10-3 cho chi nhánh).')
          : tr('Could not save. Try again.', 'Không lưu được. Thử lại.'),
        )
        return
      }
      setSaved(true); onSaved()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

  const field = 'w-full rounded-xl px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted'
  const initials = getInitials(name)

  return (
    <div>
      <label className="group relative inline-block cursor-pointer" title={tr('Change logo', 'Đổi logo')}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-foreground">{initials}</span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-sm ring-2 ring-background transition-transform group-hover:scale-105">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="biz-name" className="mb-1 block text-xs font-semibold text-body">{tr('Business name', 'Tên doanh nghiệp')}</label>
          <input id="biz-name" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
        </div>
        <div>
          <label htmlFor="biz-rep" className="mb-1 block text-xs font-semibold text-body">{tr('Your name (representative)', 'Tên người đại diện')}</label>
          <input id="biz-rep" autoComplete="name" value={rep} onChange={(e) => setRep(e.target.value)} maxLength={80} placeholder={tr('e.g. Minh', 'vd. Minh')} className={field} />
          <p className="mt-1 text-[11px] text-ink-4">{tr('The person on this account — buyers see the business name, not this.', 'Người dùng tài khoản này — người mua thấy tên doanh nghiệp, không phải tên này.')}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="biz-location" className="block text-xs font-semibold text-body">{tr('Location', 'Khu vực')}</label>
            <button type="button" onClick={useMyLocation} disabled={locating} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-foreground hover:underline disabled:opacity-50 cursor-pointer">
              {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />} {tr('Use my location', 'Dùng vị trí của tôi')}
            </button>
          </div>
          <input id="biz-location" autoComplete="address-level2" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder={tr('e.g. District 1, HCMC', 'vd. Quận 1, TP.HCM')} className={field} />
        </div>
        <div>
          <label htmlFor="biz-phone" className="mb-1 block text-xs font-semibold text-body">{tr('Contact phone / Zalo', 'Điện thoại / Zalo')}</label>
          <input id="biz-phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="0901 234 567" className={field} />
          <p className="mt-1 text-[11px] text-ink-4">{tr('Shared with a buyer only after you reply in chat — never shown publicly.', 'Chỉ chia sẻ với người mua sau khi bạn trả lời — không hiển thị công khai.')}</p>
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="biz-bio" className="mb-1 block text-xs font-semibold text-body">{tr('About', 'Giới thiệu')}</label>
        <textarea id="biz-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} placeholder={tr('Tell buyers about your business…', 'Giới thiệu doanh nghiệp của bạn…')} className={cn(field, 'resize-none')} />
      </div>

      {/* Legal information — Đ.29 ND52 + Law 122/2025: platforms must collect the
          seller's legal name, address, ID/registration number and tax code. Shown
          to authorities/buyers on request only — never on the public storefront. */}
      <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground">{tr('Legal information', 'Thông tin pháp lý')}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-4">
          {tr('Required of sellers by Vietnamese e-commerce law. Kept private — provided only to authorities, or to a buyer on lawful request. Never shown on your storefront.', 'Pháp luật TMĐT Việt Nam yêu cầu người bán cung cấp. Được bảo mật — chỉ cung cấp cho cơ quan chức năng hoặc người mua theo yêu cầu hợp pháp. Không hiển thị trên gian hàng.')}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="biz-legal-name" className="mb-1 block text-xs font-semibold text-body">{tr('Registered legal name', 'Tên pháp lý / tên đăng ký')}</label>
            <input id="biz-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={160} placeholder={tr('Company name on the ERC, or your full legal name', 'Tên trên GCN ĐKDN, hoặc họ tên đầy đủ')} className={field} />
          </div>
          <div>
            <label htmlFor="biz-legal-address" className="mb-1 block text-xs font-semibold text-body">{tr('Registered address', 'Địa chỉ đăng ký')}</label>
            <input id="biz-legal-address" value={legalAddress} onChange={(e) => setLegalAddress(e.target.value)} maxLength={240} placeholder={tr('Head office (business) or residence (individual)', 'Trụ sở (doanh nghiệp) hoặc nơi cư trú (cá nhân)')} className={field} />
          </div>
          <div>
            <label htmlFor="biz-id-number" className="mb-1 block text-xs font-semibold text-body">{tr('CCCD / business registration no.', 'Số CCCD / GCN ĐKDN')}</label>
            <input id="biz-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode="numeric" maxLength={16} className={field} />
          </div>
          <div>
            <label htmlFor="biz-tax-code" className="mb-1 block text-xs font-semibold text-body">{tr('Tax code (if any)', 'Mã số thuế (nếu có)')}</label>
            <input id="biz-tax-code" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} inputMode="numeric" maxLength={14} placeholder="0312345678" className={field} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="cta" size="none" onClick={save} disabled={saving || !dirty || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm transition-colors disabled:opacity-40 cursor-pointer">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved && !dirty ? <Check className="h-4 w-4" /> : null}
          {saved && !dirty ? tr('Saved', 'Đã lưu') : tr('Save changes', 'Lưu thay đổi')}
        </Button>
        {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
      </div>
    </div>
  )
}

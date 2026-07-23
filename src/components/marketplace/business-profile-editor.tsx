'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, Plus, LocateFixed } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { WardPicker, findUnit, type Geo } from './area-filter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError } from '@/components/ui/field'
import { getInitials } from '@/lib/utils'
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
  // The server names the field it rejected (`bad_tax_code`, `phone_taken`, …), so the message is
  // shown ON that field via <Field invalid>/<FieldError> — it lands in the control's
  // aria-describedby and marks it aria-invalid. `error` stays for the FORM-level residue only
  // (save failed, logo upload failed, an unmapped code): role="alert", bound to no single input.
  const [fieldErr, setFieldErr] = useState<{ name?: string; rep?: string; bio?: string; phone?: string; idNumber?: string; taxCode?: string }>({})
  const [error, setError] = useState('')

  // The geolocated pick, resolved to REAL /api/geo units — handed to WardPicker's
  // `value` prop so the dropdowns SHOW the located area (they used to stay empty:
  // reverse-geocode's province/ward names were fetched and thrown away, owner-reported).
  const [locatedPick, setLocatedPick] = useState<{ province: Geo | null; ward: Geo | null } | null>(null)
  // Generation guard (post-wizard pattern): only the LATEST locate applies, and a
  // manual dropdown pick supersedes an in-flight locate's seconds-long awaits.
  const locReq = useRef(0)

  // One-tap: fill Location from the device's GPS via reverse-geocoding, resolving the
  // geocoder's display NAMES to /api/geo codes (findUnit over name/nameEn, diacritic-
  // insensitive; ward matched from `wardCandidates` — the precise top result often
  // omits the official 2025 ward). Mirrors post-wizard.tsx's useMyLocation.
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    setLocating(true)
    const reqId = ++locReq.current
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(`/api/reverse-geocode?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`)
          const d = await r.json()
          const addr = d.address || [d.ward, d.province].filter(Boolean).join(', ')
          if (addr && reqId === locReq.current) setLocation(addr)
          if (!d.province) return
          const cands: string[] = Array.isArray(d.wardCandidates) && d.wardCandidates.length ? d.wardCandidates : (d.ward ? [d.ward] : [])
          const provs = await fetch('/api/geo?type=provinces').then((res) => res.json()).then((j) => j.provinces || []).catch(() => [])
          const p = findUnit(provs, d.province)
          if (!p) return // names the dataset doesn't know → free-text already set above
          let ward: Geo | null = null
          const wl = await fetch(`/api/geo?type=wards&province=${p.code}`).then((res) => res.json()).then((j) => j.wards || []).catch(() => [])
          for (const c of cands) { const w = findUnit(wl, c); if (w) { ward = { code: w.code, name: w.name, nameEn: w.nameEn }; break } }
          if (reqId !== locReq.current) return // superseded by a newer locate or a hand-pick
          setLocatedPick({ province: { code: p.code, name: p.name, nameEn: p.nameEn }, ward })
          // Canonical display string from the RESOLVED units — but only when the ward
          // resolved too: "Ward, Province" beats the raw geocoder string, while a bare
          // province name would LOSE the street/ward detail already set above (review catch).
          if (ward) setLocation([ward.name, p.name].join(', '))
        } catch { /* keep manual value */ } finally {
          if (reqId === locReq.current) setLocating(false)
        }
      },
      // Same generation guard as success: an OLD locate's error must not clear the
      // spinner a NEWER locate still owns (review catch).
      () => { if (reqId === locReq.current) setLocating(false) },
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
      form.append('kind', 'avatar') // shop logo — exempt from the listing watermark
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json()
      if (d.urls?.[0]) setAvatarUrl(d.urls[0])
      else throw new Error('upload')
    } catch { setError(tr('Logo upload failed.', 'Tải logo thất bại.')) } finally { setUploading(false) }
  }

  const save = async () => {
    setSaving(true); setError(''); setFieldErr({}); setSaved(false)
    try {
      // The representative's name lives on the Profile (one business → many staff,
      // each their own account), saved alongside the storefront fields. A failure
      // here must not fall through to a green "Saved" from the seller PATCH alone.
      if (rep.trim() && rep.trim() !== (repName || '')) {
        const repRes = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: rep.trim() }) })
        if (!repRes.ok) {
          setFieldErr({ rep: tr('Could not save your name — please try again.', 'Không lưu được tên của bạn — vui lòng thử lại.') })
          return
        }
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
        // Route each server code to the field it is ABOUT. Anything unrecognised stays form-level —
        // guessing a field for an unknown code would point a screen reader at the wrong input.
        if (d.error === 'no_phone_in_profile') {
          // The API rejects the pair, not one of them: flag both places a number could hide.
          const msg = tr("Phone numbers aren't allowed in the name/about.", 'Không ghi số trong tên/giới thiệu.')
          setFieldErr({ name: msg, bio: msg })
        } else if (d.error === 'phone_taken') {
          setFieldErr({ phone: tr('That phone is already used by another storefront.', 'Số này đã được dùng cho gian hàng khác.') })
        } else if (d.error === 'bad_phone') {
          setFieldErr({ phone: tr('Enter a valid phone number.', 'Nhập số điện thoại hợp lệ.') })
        } else if (d.error === 'bad_id_number') {
          setFieldErr({ idNumber: tr('ID/ERC number should be 9–13 digits.', 'Số CCCD/ĐKDN gồm 9–13 chữ số.') })
        } else if (d.error === 'bad_tax_code') {
          setFieldErr({ taxCode: tr('Tax code format: 10 digits (or 10-3 with branch).', 'Mã số thuế: 10 chữ số (hoặc 10-3 cho chi nhánh).') })
        } else {
          setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.'))
        }
        return
      }
      setSaved(true); onSaved()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field invalid={!!fieldErr.name}>
          <Label htmlFor="biz-name">{tr('Business name', 'Tên doanh nghiệp')}</Label>
          <FieldControl id="biz-name" render={<Input id="biz-name" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />} />
          {fieldErr.name && <FieldError>{fieldErr.name}</FieldError>}
        </Field>
        <Field invalid={!!fieldErr.rep}>
          <Label htmlFor="biz-rep">{tr('Your name (representative)', 'Tên người đại diện')}</Label>
          <FieldControl id="biz-rep" render={<Input id="biz-rep" autoComplete="name" value={rep} onChange={(e) => setRep(e.target.value)} maxLength={80} placeholder={tr('e.g. Minh', 'vd. Minh')} />} />
          {fieldErr.rep && <FieldError>{fieldErr.rep}</FieldError>}
          <p className="text-xs text-muted-foreground">{tr('The person on this account — buyers see the business name, not this.', 'Người dùng tài khoản này — người mua thấy tên doanh nghiệp, không phải tên này.')}</p>
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="biz-location">{tr('Location', 'Khu vực')}</Label>
            <Button type="button" variant="bare" size="none" onClick={useMyLocation} disabled={locating} className="items-center gap-1 whitespace-normal rounded-none text-2xs font-semibold text-accent-foreground hover:underline cursor-pointer">
              {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />} {tr('Use my location', 'Dùng vị trí của tôi')}
            </Button>
          </div>
          {/* Structured two-tier pick (city → ward, user decision 2026-07-13):
              writes "Ward, Province" into the free-text field below, which stays
              editable and keeps legacy values + the geolocate flow working. */}
          <WardPicker
            value={locatedPick}
            onPick={({ province, ward }) => {
              // A hand-pick supersedes any in-flight locate AND clears the adopted
              // value, so a repeat locate to the same place can re-adopt cleanly.
              // The superseded locate's finally() deliberately won't touch the spinner
              // (it lost the generation race), so the pick clears it here — otherwise
              // it spins forever (review catch).
              locReq.current++
              setLocating(false)
              setLocatedPick(null)
              const parts = [ward?.name, province?.name].filter(Boolean)
              if (parts.length) setLocation(parts.join(', '))
            }}
          />
          <Input id="biz-location" autoComplete="address-level2" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder={tr('e.g. Thảo Điền, HCMC', 'vd. Thảo Điền, TP.HCM')} />
        </div>
        <Field invalid={!!fieldErr.phone}>
          <Label htmlFor="biz-phone">{tr('Contact phone (Zalo / WhatsApp)', 'Điện thoại (Zalo / WhatsApp)')}</Label>
          <FieldControl id="biz-phone" render={<Input id="biz-phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="0901 234 567" />} />
          <FieldDescription className="text-muted-foreground">{tr('Shared with a buyer only after you reply in chat — never shown publicly.', 'Chỉ chia sẻ với người mua sau khi bạn trả lời — không hiển thị công khai.')}</FieldDescription>
          {fieldErr.phone && <FieldError>{fieldErr.phone}</FieldError>}
        </Field>
      </div>
      <Field className="mt-4" invalid={!!fieldErr.bio}>
        <Label htmlFor="biz-bio">{tr('About', 'Giới thiệu')}</Label>
        <FieldControl id="biz-bio" render={<Textarea id="biz-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} placeholder={tr('Tell buyers about your business…', 'Giới thiệu doanh nghiệp của bạn…')} className="resize-none" />} />
        {fieldErr.bio && <FieldError>{fieldErr.bio}</FieldError>}
      </Field>

      {/* Legal information — Đ.29 ND52 + Law 122/2025: platforms must collect the
          seller's legal name, address, ID/registration number and tax code. Shown
          to authorities/buyers on request only — never on the public storefront. */}
      <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground">{tr('Legal information', 'Thông tin pháp lý')}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {tr('Required of sellers by Vietnamese e-commerce law. Kept private — provided only to authorities, or to a buyer on lawful request. Never shown on your storefront.', 'Pháp luật TMĐT Việt Nam yêu cầu người bán cung cấp. Được bảo mật — chỉ cung cấp cho cơ quan chức năng hoặc người mua theo yêu cầu hợp pháp. Không hiển thị trên gian hàng.')}
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="biz-legal-name">{tr('Registered legal name', 'Tên pháp lý / tên đăng ký')}</Label>
            <Input id="biz-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={160} placeholder={tr('Company name on the ERC, or your full legal name', 'Tên trên GCN ĐKDN, hoặc họ tên đầy đủ')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-legal-address">{tr('Registered address', 'Địa chỉ đăng ký')}</Label>
            <Input id="biz-legal-address" value={legalAddress} onChange={(e) => setLegalAddress(e.target.value)} maxLength={240} placeholder={tr('Head office (business) or residence (individual)', 'Trụ sở (doanh nghiệp) hoặc nơi cư trú (cá nhân)')} />
          </div>
          <Field invalid={!!fieldErr.idNumber}>
            <Label htmlFor="biz-id-number">{tr('CCCD / business registration no.', 'Số CCCD / GCN ĐKDN')}</Label>
            <FieldControl id="biz-id-number" render={<Input id="biz-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode="numeric" maxLength={16} />} />
            {fieldErr.idNumber && <FieldError>{fieldErr.idNumber}</FieldError>}
          </Field>
          <Field invalid={!!fieldErr.taxCode}>
            <Label htmlFor="biz-tax-code">{tr('Tax code (if any)', 'Mã số thuế (nếu có)')}</Label>
            <FieldControl id="biz-tax-code" render={<Input id="biz-tax-code" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} inputMode="numeric" maxLength={14} placeholder="0312345678" />} />
            {fieldErr.taxCode && <FieldError>{fieldErr.taxCode}</FieldError>}
          </Field>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="cta" onClick={save} disabled={saving || !dirty || name.trim().length < 2}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved && !dirty ? <Check className="h-4 w-4" /> : null}
          {saved && !dirty ? tr('Saved', 'Đã lưu') : tr('Save changes', 'Lưu thay đổi')}
        </Button>
        {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Plus } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError } from '@/components/ui/field'
import { compressImageFile } from '@/lib/normalize-image'
import { Avatar } from '@/components/ui/avatar'

type Profile = { displayName: string | null; avatarUrl: string | null; avatarColor: string; phone: string | null }

/** The signed-in person's own profile (name, photo, contact phone) → PATCH
 *  /api/profile. Used by individuals; businesses edit their storefront separately. */
export function ProfileEditor({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [name, setName] = useState(profile.displayName || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  // Per-field server rejections (bad_phone, name_too_short, …) render ON the field via
  // <Field invalid>/<FieldError>; `error` is the FORM-level residue (photo upload, unmapped code).
  const [fieldErr, setFieldErr] = useState<{ name?: string; phone?: string }>({})
  const [error, setError] = useState('')

  useEffect(() => {
    setName(profile.displayName || ''); setPhone(profile.phone || ''); setAvatarUrl(profile.avatarUrl)
  }, [profile.displayName, profile.phone, profile.avatarUrl])

  const dirty = name !== (profile.displayName || '') || phone !== (profile.phone || '') || avatarUrl !== profile.avatarUrl

  const uploadPhoto = async (file: File) => {
    setUploading(true); setError('')
    try {
      file = await compressImageFile(file) // HEIC→JPEG + downscale so big photos don't 413
      const form = new FormData(); form.append('files', file)
      form.append('kind', 'avatar') // profile photo — exempt from the listing watermark
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json()
      if (d.urls?.[0]) setAvatarUrl(d.urls[0]); else throw new Error('upload')
    } catch { setError(tr('Photo upload failed.', 'Tải ảnh thất bại.')) } finally { setUploading(false) }
  }

  const save = async () => {
    setSaving(true); setError(''); setFieldErr({}); setSaved(false)
    try {
      // Only send avatarUrl when it actually changed — re-sending an unchanged
      // default/Google avatar (not a Supabase-bucket URL) would 400 as bad_avatar.
      const payload: Record<string, unknown> = { displayName: name.trim(), phone }
      if (avatarUrl !== profile.avatarUrl) payload.avatarUrl = avatarUrl
      const res = await fetch('/api/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Route each server code to the field it is ABOUT; an unknown code stays form-level rather
        // than being pinned to an arbitrary input.
        if (d.error === 'phone_taken') {
          setFieldErr({ phone: tr('That phone is already in use.', 'Số này đã được dùng.') })
        } else if (d.error === 'bad_phone') {
          setFieldErr({ phone: tr('Enter a valid phone number.', 'Nhập số điện thoại hợp lệ.') })
        } else if (d.error === 'name_too_short') {
          setFieldErr({ name: tr('Enter your name.', 'Nhập tên của bạn.') })
        } else if (d.error === 'no_phone_in_name' || d.error === 'no_contact_in_name') {
          // The name field has TWO server rejections, not one, and this branch only listened for
          // the first: containsPhoneNumber() throws `no_phone_in_name`, and containsContactInfo()
          // — which also catches an email or a URL smuggled into the name — throws
          // `no_contact_in_name`. Anyone who put an email in their name therefore got the generic
          // "Could not save. Try again." with no indication of which field was wrong, which is the
          // exact failure this mapping exists to prevent. Both codes are the same story to a
          // person: contact details do not belong in a display name.
          setFieldErr({ name: tr("Contact details aren't allowed in your name.", 'Không ghi thông tin liên hệ trong tên.') })
        } else {
          setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.'))
        }
        return
      }
      setSaved(true); onSaved()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

  return (
    <div>
      <label className="group relative inline-block cursor-pointer" title={tr('Change photo', 'Đổi ảnh')}>
        <Avatar name={name} url={avatarUrl} color={profile.avatarColor} size="xl" />
        {/* Line-only CHROME, not a coin: §6's coin allowlist is enumerative (EmptyState badge,
            bottom-nav Post chip) and this affordance is neither — the R2 critic flagged the
            bg-brand-50 disc here as an unsanctioned third coin location. A bordered card disc
            with ink-line Plus is the Vinted/Carousell avatar-edit idiom; the ring-2
            ring-background cutout still separates it from the photo underneath. */}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-card text-body ring-2 ring-background transition-transform group-hover:scale-105">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field invalid={!!fieldErr.name}>
          <Label htmlFor="profile-name">{tr('Your name', 'Tên của bạn')}</Label>
          <FieldControl id="profile-name" render={<Input id="profile-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr('e.g. Minh', 'vd. Minh')} />} />
          {fieldErr.name && <FieldError>{fieldErr.name}</FieldError>}
        </Field>
        <Field invalid={!!fieldErr.phone}>
          <Label htmlFor="profile-phone">{tr('Contact phone (Zalo / WhatsApp)', 'Điện thoại (Zalo / WhatsApp)')}</Label>
          <FieldControl id="profile-phone" render={<Input id="profile-phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="0901 234 567" />} />
          <FieldDescription className="text-muted-foreground">{tr('Shared with a buyer only after you reply in chat — never shown publicly.', 'Chỉ chia sẻ sau khi bạn trả lời — không hiển thị công khai.')}</FieldDescription>
          {fieldErr.phone && <FieldError>{fieldErr.phone}</FieldError>}
        </Field>
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

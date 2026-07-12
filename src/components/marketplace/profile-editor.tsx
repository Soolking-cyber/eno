'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Plus } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
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
    setSaving(true); setError(''); setSaved(false)
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
        setError(
          d.error === 'phone_taken' ? tr('That phone is already in use.', 'Số này đã được dùng.')
          : d.error === 'bad_phone' ? tr('Enter a valid phone number.', 'Nhập số điện thoại hợp lệ.')
          : d.error === 'name_too_short' ? tr('Enter your name.', 'Nhập tên của bạn.')
          : tr('Could not save. Try again.', 'Không lưu được. Thử lại.'),
        )
        return
      }
      setSaved(true); onSaved()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

  // Borderless house input — slate tint fill (no border) + brand focus ring.
  const field = 'w-full rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-brand/20 placeholder:text-ink-4'

  return (
    <div>
      <label className="group relative inline-block cursor-pointer" title={tr('Change photo', 'Đổi ảnh')}>
        <Avatar name={name} url={avatarUrl} color={profile.avatarColor} size="xl" />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-sm ring-2 ring-background transition-transform group-hover:scale-105">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-name" className="mb-1 block text-xs font-semibold text-body">{tr('Your name', 'Tên của bạn')}</label>
          <input id="profile-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr('e.g. Minh', 'vd. Minh')} className={field} />
        </div>
        <div>
          <label htmlFor="profile-phone" className="mb-1 block text-xs font-semibold text-body">{tr('Contact phone / Zalo', 'Điện thoại / Zalo')}</label>
          <input id="profile-phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="0901 234 567" className={field} />
          <p className="mt-1 text-2xs text-ink-4">{tr('Shared with a buyer only after you reply in chat — never shown publicly.', 'Chỉ chia sẻ sau khi bạn trả lời — không hiển thị công khai.')}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="cta" size="none" onClick={save} disabled={saving || !dirty || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm transition-colors disabled:opacity-40 cursor-pointer">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved && !dirty ? <Check className="h-4 w-4" /> : null}
          {saved && !dirty ? tr('Saved', 'Đã lưu') : tr('Save changes', 'Lưu thay đổi')}
        </Button>
        {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
      </div>
    </div>
  )
}

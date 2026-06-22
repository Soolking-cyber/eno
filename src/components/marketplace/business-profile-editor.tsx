'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, Upload } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

type Seller = { id: string; name: string; bio: string | null; location: string | null; avatarUrl: string | null }

/** Inline business-profile editor (business tier). Edits the storefront's
 *  name/about/location/logo via the owner-scoped PATCH /api/seller. */
export function BusinessProfileEditor({ seller, onSaved }: { seller: Seller; onSaved: () => void }) {
  const { tr } = useLanguage()
  const [name, setName] = useState(seller.name)
  const [bio, setBio] = useState(seller.bio || '')
  const [location, setLocation] = useState(seller.location || '')
  const [avatarUrl, setAvatarUrl] = useState(seller.avatarUrl)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Re-sync local fields when the saved storefront changes (e.g. after refresh()
  // returns the server-trimmed values) so the form doesn't read perpetually dirty.
  useEffect(() => {
    setName(seller.name); setBio(seller.bio || ''); setLocation(seller.location || ''); setAvatarUrl(seller.avatarUrl)
  }, [seller.name, seller.bio, seller.location, seller.avatarUrl])

  const dirty = name !== seller.name || bio !== (seller.bio || '') || location !== (seller.location || '') || avatarUrl !== seller.avatarUrl

  const uploadLogo = async (file: File) => {
    setUploading(true); setError('')
    try {
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
      const res = await fetch('/api/seller', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), bio, location, avatarUrl }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error === 'no_phone_in_profile' ? tr("Phone numbers aren't allowed here.", 'Không được ghi số điện thoại.') : tr('Could not save. Try again.', 'Không lưu được. Thử lại.'))
        return
      }
      setSaved(true); onSaved()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

  const field = 'w-full rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring/30'
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div>
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-foreground">{initials}</span>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-tint px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-muted">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {tr('Change logo', 'Đổi logo')}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Business name', 'Tên doanh nghiệp')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Location', 'Khu vực')}</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder={tr('e.g. District 1, HCMC', 'vd. Quận 1, TP.HCM')} className={field} />
        </div>
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-body">{tr('About', 'Giới thiệu')}</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} placeholder={tr('Tell buyers about your business…', 'Giới thiệu doanh nghiệp của bạn…')} className={cn(field, 'resize-none')} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-40 cursor-pointer">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved && !dirty ? <Check className="h-4 w-4" /> : null}
          {saved && !dirty ? tr('Saved', 'Đã lưu') : tr('Save changes', 'Lưu thay đổi')}
        </button>
        {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
      </div>
    </div>
  )
}

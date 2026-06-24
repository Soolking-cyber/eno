'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, X, ArrowLeft } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

export type EditableListing = {
  id: string
  title: string
  description: string
  price: number
  district: string | null
  condition: string | null
  brand?: string | null      // current brand display name (product categories only)
  model?: string | null      // current model (product categories only)
  showBrand?: boolean        // whether this listing's category supports a brand
  images: string[]
  currency: string
}

/** Owner-only listing editor. Edits the fields PATCH /api/listings/[id] accepts
 *  (title/description/price/district/condition/images), then returns to the
 *  dashboard. Mirrors the post wizard's validation surface. */
export function ListingEditor({ listing }: { listing: EditableListing }) {
  const { tr } = useLanguage()
  const router = useRouter()
  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description)
  const [price, setPrice] = useState(String(listing.price))
  const [district, setDistrict] = useState(listing.district || '')
  const [condition, setCondition] = useState(listing.condition || '')
  const [brand, setBrand] = useState(listing.brand || '')
  const [model, setModel] = useState(listing.model || '')
  const [images, setImages] = useState<string[]>(listing.images)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const addPhotos = async (files: FileList) => {
    setUploading(true); setError('')
    try {
      const form = new FormData()
      Array.from(files).slice(0, 8).forEach((f) => form.append('files', f))
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json()
      if (Array.isArray(d.urls)) setImages((prev) => [...prev, ...d.urls].slice(0, 8))
      else throw new Error('upload')
    } catch { setError(tr('Photo upload failed.', 'Tải ảnh thất bại.')) } finally { setUploading(false) }
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          district: district.trim() || null,
          condition: condition || null,
          ...(listing.showBrand ? { brand: brand.trim() || null, model: model.trim() || null } : {}),
          images,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          d.error === 'title_too_short' ? tr('Title is too short.', 'Tiêu đề quá ngắn.')
          : d.error === 'no_phone_in_listing' ? tr("Phone numbers aren't allowed in the title or description.", 'Không ghi số điện thoại trong tiêu đề hoặc mô tả.')
          : d.error === 'invalid_price' ? tr('Enter a valid price.', 'Nhập giá hợp lệ.')
          : d.error === 'forbidden' || d.error === 'no_storefront' ? tr("You can't edit this listing.", 'Bạn không thể sửa tin này.')
          : tr('Could not save. Try again.', 'Không lưu được. Thử lại.'),
        )
        return
      }
      // Back to the dashboard; it revalidates its own data on mount.
      router.push('/dashboard?tab=listings')
      router.refresh()
    } catch { setError(tr('Could not save. Try again.', 'Không lưu được. Thử lại.')) } finally { setSaving(false) }
  }

  // Visible field surface (matches the post wizard) so inputs read as editable boxes
  // on the canvas — not plain text with blank gaps.
  const field = 'w-full rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4'

  return (
    <div className="mx-auto w-full max-w-2xl px-3 sm:px-6 lg:px-8 py-6">
      <button onClick={() => router.push('/dashboard?tab=listings')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-body transition-colors hover:text-accent-foreground cursor-pointer">
        <ArrowLeft className="h-4 w-4" /> {tr('Back to listings', 'Về danh sách tin')}
      </button>
      <h1 className="h-title text-foreground">{tr('Edit listing', 'Sửa tin đăng')}</h1>

      <div className="mt-5 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Title', 'Tiêu đề')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} className={field} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Description', 'Mô tả')}</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} className={cn(field, 'resize-none')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-body">{tr('Price', 'Giá')} ({listing.currency})</label>
            <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-body">{tr('Area', 'Khu vực')}</label>
            <input value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={80} placeholder={tr('e.g. District 1', 'vd. Quận 1')} className={field} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Condition', 'Tình trạng')}</label>
          <div className="flex gap-2">
            {[['', tr('Not applicable', 'Không áp dụng')], ['new', tr('New', 'Mới')], ['used', tr('Used', 'Đã dùng')]].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setCondition(v)} className={cn('rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer', condition === v ? 'text-accent-foreground' : 'text-body hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {listing.showBrand && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-body">{tr('Brand', 'Thương hiệu')}</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={40} placeholder={tr('e.g. Apple, Samsung, Honda', 'vd. Apple, Samsung, Honda')} className={field} />
            </div>
            {brand.trim() && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-body">{tr('Model', 'Model')}</label>
                <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} placeholder={tr('e.g. iPhone 14 Pro', 'vd. iPhone 14 Pro')} className={field} />
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-body">{tr('Photos', 'Hình ảnh')}</label>
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={src} className="relative h-20 w-20 overflow-hidden rounded-xl bg-tint">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label={tr('Remove', 'Xóa')} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {images.length < 8 && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl bg-tint text-body transition-colors hover:bg-muted">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files) }} />
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} disabled={saving || title.trim().length < 3} className="inline-flex items-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-40 cursor-pointer">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Save changes', 'Lưu thay đổi')}
          </button>
          {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  )
}

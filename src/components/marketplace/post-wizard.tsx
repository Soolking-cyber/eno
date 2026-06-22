'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ImagePlus, X, BadgeCheck, ShieldCheck } from 'lucide-react'
import type { SerializedCategory } from '@/lib/types'
import { CategoryIcon } from './category-icons'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import { containsPhoneNumber } from '@/lib/phone'
import { trackPostListing } from '@/lib/analytics'
import { VndInput } from './vnd-input'
import { CustomSelect } from './custom-select'
import { Mascot } from './mascot'
import { formatMoneyFull } from '@/lib/vnd'

const DISTRICTS = ['District 1', 'District 3', 'District 4', 'District 7 (Phu My Hung)', 'Binh Thanh', 'Thu Duc (Thao Dien)', 'Phu Nhuan', 'Tan Binh']
const STEPS = 4

export function PostWizard({ categories }: { categories: SerializedCategory[] }) {
  const { lang, tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [step, setStep] = useState(1)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [district, setDistrict] = useState('')
  const [condition, setCondition] = useState('')
  const [photos, setPhotos] = useState<{ url: string; file: File }[]>([])
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [postingAs, setPostingAs] = useState<string | null>(null) // business name, if any

  // Pick up contact from the signed-in profile so sellers don't retype it. For a
  // business, prefill the storefront name + phone and show "Posting as <business>".
  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((d) => {
      const u = d.user
      if (!u) return
      setContactName((p) => p || u.seller?.name || u.displayName || '')
      setContactPhone((p) => p || u.seller?.phone || u.phone || '')
      if (u.accountType === 'business') setPostingAs(u.businessName || u.seller?.name || null)
    }).catch(() => {})
  }, [])

  const cat = categories.find((c) => c.slug === categorySlug)
  const isGoods = categorySlug === 'electronics' || categorySlug === 'moving-sale'
  const phoneOk = contactPhone.replace(/\D/g, '').length >= 9

  const canContinue =
    step === 1 ? !!categorySlug :
    step === 2 ? title.trim().length >= 3 :
    step === 3 ? price.trim().length > 0 && !!district :
    true
  const canSubmit = contactName.trim().length >= 2 && phoneOk && !submitting

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).slice(0, 6 - photos.length).map((f) => ({ url: URL.createObjectURL(f), file: f }))
    setPhotos((p) => [...p, ...next])
  }

  const submit = async () => {
    if (!canSubmit) return
    // Block contact info in the public fields BEFORE uploading — buyers reach you
    // in-app (which keeps you coming back to reply + update availability).
    if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsPhoneNumber(contactName)) {
      setError(t('Không được ghi số điện thoại trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng.', "Phone numbers aren't allowed in a listing — buyers message you in the app. Remove it to post."))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      // 1. Upload photos to Supabase Storage — a failure here is a hard error,
      //    never silently create a photoless listing.
      let imageUrls: string[] = []
      if (photos.length > 0) {
        const form = new FormData()
        photos.forEach((p) => form.append('files', p.file))
        const up = await fetch('/api/upload', { method: 'POST', body: form })
        if (!up.ok) throw new Error('upload')
        imageUrls = (await up.json()).urls || []
        if (imageUrls.length < photos.length) throw new Error('upload')
      }
      // 2. Create the listing (verified=false — pending review)
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categorySlug,
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          district: district || null,
          condition: isGoods ? condition || null : null,
          images: imageUrls,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed')
      // Published successfully → fire the sell-side conversion (once; this path is
      // only reached on a 2xx, the Submit button is disabled while submitting, and
      // success unmounts the form). Listings are always priced in VND (₫).
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      trackPostListing({
        id: created.id,
        title: title.trim(),
        price: Number(price),
        currency: 'VND',
        category: cat?.name || categorySlug,
        district: district || undefined,
      })
      setSubmitted(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg === 'upload'
          ? t('Không tải được ảnh, vui lòng thử lại.', 'Could not upload your photos — please try again.')
          : msg === 'no_phone_in_listing'
          ? t('Không được ghi số điện thoại trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng.', "Phone numbers aren't allowed in a listing — buyers message you in the app. Remove it to post.")
          : t('Không gửi được, vui lòng thử lại.', 'Could not submit — please try again.'),
      )
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Mascot name="success" className="h-28 w-28" />
        <h1 className="h-title text-foreground">{t('Tin của bạn đã được đăng!', 'Your listing is live!')}</h1>
        <p className="max-w-md text-sm text-body">
          {t(
            'Tin của bạn đã hiển thị công khai. Người mua sẽ nhắn tin cho bạn ngay trong ứng dụng — số điện thoại của bạn được giữ kín cho đến khi bạn trả lời.',
            'It’s now visible to buyers. They’ll message you in-app — your number stays private until you reply.',
          )}
        </p>
        <a href="/dashboard" className="mt-2 rounded-xl bg-[#0a66c2] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
          {t('Tới bảng điều khiển', 'Go to dashboard')}
        </a>
      </div>
    )
  }

  return (
    <div>
      {/* Progress */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => (step > 1 ? setStep((s) => s - 1) : (window.location.href = '/'))}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" /> {step > 1 ? t('Quay lại', 'Back') : t('Thoát', 'Exit')}
          </button>
          <span className="text-xs font-semibold text-ink-4">{t('Bước', 'Step')} {step}/{STEPS}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
          <div className="h-full rounded-full bg-[#0a66c2] transition-all duration-300" style={{ width: `${(step / STEPS) * 100}%` }} />
        </div>
      </div>

      {/* key remounts on step change → CSS slide-in (replaces framer AnimatePresence) */}
      <div key={step} className="animate-in fade-in slide-in-from-right-4 duration-200">
          {step === 1 && (
            <div className="space-y-4">
              <h1 className="h-title text-foreground">{t('Bạn muốn đăng gì?', 'What are you listing?')}</h1>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategorySlug(c.slug)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-2xl border p-5 transition-all cursor-pointer',
                      categorySlug === c.slug ? 'border-[#0a66c2] bg-accent' : 'border-border hover:border-[#0a66c2]/40 hover:bg-tint',
                    )}
                  >
                    <CategoryIcon name={c.icon} className={cn('h-7 w-7', categorySlug === c.slug ? 'text-accent-foreground' : 'text-ink-4')} />
                    <span className="text-sm font-bold text-foreground">{lang === 'vi' ? c.nameVi : c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h1 className="h-title text-foreground">{t('Mô tả tin đăng', 'Describe your listing')}</h1>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">{t('Tiêu đề', 'Title')}</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('VD: iPhone 14 128GB — pin 92%', 'e.g. iPhone 14 128GB — battery 92%')}
                  className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">{t('Mô tả', 'Description')}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder={t('Tình trạng, lý do bán, thông tin liên hệ...', 'Condition, reason for selling, details…')}
                  className="w-full resize-none rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h1 className="h-title text-foreground">{t('Giá, khu vực & ảnh', 'Price, area & photos')}</h1>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">{t('Giá (VND)', 'Price (VND)')}</label>
                <VndInput value={price} onChange={setPrice} placeholder={t('Nhập giá', 'Enter price')} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">{t('Khu vực', 'Area')}</label>
                <CustomSelect
                  value={district}
                  onChange={setDistrict}
                  options={DISTRICTS.map((d) => ({ value: d, label: d }))}
                  placeholder={t('Chọn khu vực', 'Select area')}
                  className="bg-tint text-body py-3"
                  activeClassName="bg-tint text-body hover:bg-accent hover:text-accent-foreground"
                />
              </div>

              {isGoods && (
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">{t('Tình trạng', 'Condition')}</label>
                  <div className="flex gap-2">
                    {[['new', t('Mới', 'New')], ['used', t('Đã dùng', 'Used')]].map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setCondition(v)}
                        className={cn('rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer', condition === v ? 'bg-[#0a66c2] text-white' : 'bg-tint text-body hover:bg-accent')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">{t('Ảnh', 'Photos')} <span className="font-normal text-ink-4">({photos.length}/6)</span></label>
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-tint">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
                      <button aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-foreground shadow-sm cursor-pointer">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 6 && (
                    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 hover:border-[#0a66c2] hover:text-accent-foreground transition-colors">
                      <ImagePlus className="h-6 w-6" />
                      <span className="text-[10px] font-semibold">{t('Thêm', 'Add')}</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <h1 className="h-title text-foreground">{t('Liên hệ & gửi', 'Contact & submit')}</h1>

              {postingAs && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-accent-foreground" />
                  {t('Đăng với tư cách', 'Posting as')} <span className="font-semibold text-foreground">{postingAs}</span>
                </p>
              )}

              {/* Contact — prefilled from your profile when signed in */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">{t('Tên của bạn', 'Your name')}</label>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder={t('VD: Minh', 'e.g. Minh')}
                    className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">{t('Số điện thoại / Zalo', 'Phone / Zalo')}</label>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="0901 234 567"
                    className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 shadow-pop space-y-3">
                <Row label={t('Danh mục', 'Category')} value={cat ? (lang === 'vi' ? cat.nameVi : cat.name) : '—'} />
                <Row label={t('Tiêu đề', 'Title')} value={title || '—'} />
                <Row label={t('Giá', 'Price')} value={price ? formatMoneyFull(Number(price), '₫') : '—'} />
                <Row label={t('Khu vực', 'Area')} value={district || '—'} />
                {isGoods && <Row label={t('Tình trạng', 'Condition')} value={condition === 'new' ? t('Mới', 'New') : condition === 'used' ? t('Đã dùng', 'Used') : '—'} />}
                <Row label={t('Ảnh', 'Photos')} value={`${photos.length}`} />
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-accent px-4 py-3 text-xs text-accent-foreground">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('Tin của bạn sẽ được nhân viên eno.vn kiểm duyệt thực tế trước khi hiển thị.', 'Your listing will be verified by an eno.vn agent before going live.')}</span>
              </div>

              {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
            </div>
          )}
      </div>

      {/* Footer nav */}
      <div className="mt-8 flex justify-end gap-3">
        {step < STEPS ? (
          <button
            onClick={() => canContinue && setStep((s) => s + 1)}
            disabled={!canContinue}
            className="rounded-xl bg-[#0a66c2] px-7 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            {t('Tiếp tục', 'Continue')}
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-[#0a66c2] px-7 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            {submitting ? t('Đang gửi…', 'Submitting…') : t('Gửi để kiểm duyệt', 'Submit for verification')}
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2.5 last:border-0 last:pb-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ImagePlus, X, ShieldCheck, MapPin, ChevronDown, Check, Lock } from 'lucide-react'
import type { SerializedCategory } from '@/lib/types'
import { CategoryIcon } from './category-icons'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import { containsPhoneNumber } from '@/lib/phone'
import { trackPostListing } from '@/lib/analytics'
import { VndInput } from './vnd-input'
import { AreaFilter, type Geo, type Nearby } from './area-filter'
import { Mascot } from './mascot'
import { formatMoneyFull } from '@/lib/vnd'
import { subcategoriesFor, typesFor, facetsFor, LISTING_TYPES } from '@/lib/taxonomy'

const TITLE_MAX = 140
const DESC_MAX = 5000

export function PostWizard({ categories }: { categories: SerializedCategory[] }) {
  const { lang, tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [subcategorySlug, setSubcategorySlug] = useState('')
  const [listingType, setListingType] = useState('sell')
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [negotiable, setNegotiable] = useState(false)
  const [condition, setCondition] = useState('')
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  const [province, setProvince] = useState<Geo | null>(null)
  const [ward, setWard] = useState<Geo | null>(null)
  const [nearby, setNearby] = useState<Nearby | null>(null)
  const [photos, setPhotos] = useState<{ url: string; file: File }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [postingAs, setPostingAs] = useState<string | null>(null)

  // Prefill contact from the signed-in profile.
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
  const subOptions = subcategoriesFor(categorySlug)
  const typeOptions = typesFor(categorySlug)
  const catFacets = facetsFor(categorySlug)
  const hasCondition = catFacets.some((f) => f.key === 'condition')
  const attrFacets = catFacets.filter((f) => f.key !== 'condition')

  const chooseCategory = (slug: string) => {
    setCategorySlug(slug)
    setSubcategorySlug('')
    setAttrs({})
    setCondition('')
    setListingType(typesFor(slug)[0] ?? 'sell')
  }

  const phoneOk = contactPhone.replace(/\D/g, '').length >= 9
  const district = ward?.name || province?.name || ''
  const areaLabel = ward ? `${ward.name}${province ? `, ${province.name}` : ''}` : province ? province.name : (nearby ? t('Vị trí của bạn', 'Your location') : '')
  const hasLocation = !!(province || ward || nearby)
  const priceUnit = listingType === 'rent' || listingType === 'job' ? t('/ tháng', '/ month') : listingType === 'service' ? t('/ dịch vụ', '/ service') : ''
  const showNegotiable = listingType === 'sell' || listingType === 'rent'

  // Required-field checklist (drives the Publish button + the "what's left" hint).
  const checks = [
    { key: 'photo', ok: photos.length >= 1, label: t('Thêm ảnh', 'Add a photo') },
    { key: 'category', ok: !!categorySlug, label: t('Chọn danh mục', 'Pick a category') },
    { key: 'title', ok: title.trim().length >= 3, label: t('Nhập tiêu đề', 'Add a title') },
    { key: 'price', ok: price.trim().length > 0, label: t('Nhập giá', 'Set a price') },
    { key: 'location', ok: hasLocation, label: t('Chọn khu vực', 'Set the area') },
    { key: 'contact', ok: contactName.trim().length >= 2 && phoneOk, label: t('Thông tin liên hệ', 'Add contact info') },
  ]
  const missing = checks.filter((c) => !c.ok)
  const canSubmit = missing.length === 0 && !submitting

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 6 - photos.length).map((f) => ({ url: URL.createObjectURL(f), file: f }))
    setPhotos((p) => [...p, ...next])
  }

  const submit = async () => {
    if (!canSubmit) return
    if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsPhoneNumber(contactName)) {
      setError(t('Không được ghi số điện thoại trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng.', "Phone numbers aren't allowed in a listing — buyers message you in the app. Remove it to post."))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      let imageUrls: string[] = []
      if (photos.length > 0) {
        const form = new FormData()
        photos.forEach((p) => form.append('files', p.file))
        const up = await fetch('/api/upload', { method: 'POST', body: form })
        if (!up.ok) throw new Error('upload')
        imageUrls = (await up.json()).urls || []
        if (imageUrls.length < photos.length) throw new Error('upload')
      }
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categorySlug,
          subcategorySlug: subcategorySlug || null,
          listingType,
          attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v)),
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          negotiable: showNegotiable && negotiable,
          district: district || null,
          city: province?.name || null,
          location: ward?.name || province?.name || null,
          lat: nearby?.lat ?? null,
          lng: nearby?.lng ?? null,
          condition: hasCondition ? condition || null : null,
          images: imageUrls,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed')
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      trackPostListing({ id: created.id, title: title.trim(), price: Number(price), currency: 'VND', category: cat?.name || categorySlug, district: district || undefined })
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
        <Mascot name="success" className="h-52 w-52" />
        <h1 className="h-title text-foreground">{t('Tin của bạn đã được đăng!', 'Your listing is live!')}</h1>
        <p className="max-w-md text-sm text-body">
          {t('Tin của bạn đã hiển thị công khai. Người mua sẽ nhắn tin cho bạn ngay trong ứng dụng — số điện thoại của bạn được giữ kín cho đến khi bạn trả lời.', 'It’s now visible to buyers. They’ll message you in-app — your number stays private until you reply.')}
        </p>
        <a href="/dashboard" className="mt-2 rounded-xl bg-[#0a66c2] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
          {t('Tới bảng điều khiển', 'Go to dashboard')}
        </a>
      </div>
    )
  }

  const PublishButton = ({ className }: { className?: string }) => (
    <button
      onClick={submit}
      disabled={!canSubmit}
      className={cn('w-full rounded-xl bg-[#0a66c2] px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-40 disabled:pointer-events-none cursor-pointer', className)}
    >
      {submitting ? t('Đang đăng…', 'Posting…') : missing.length ? t(`Còn ${missing.length} mục`, `${missing.length} left to finish`) : t('Đăng tin', 'Publish listing')}
    </button>
  )

  return (
    <div className="pb-28 lg:pb-0">
      <a href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors cursor-pointer">
        <ChevronLeft className="h-4 w-4" /> {t('Thoát', 'Exit')}
      </a>
      <h1 className="mt-3 h-display text-foreground">{t('Tạo tin đăng', 'Create a listing')}</h1>
      <p className="mt-1 text-[15px] text-body">{t('Điền các mục bên dưới — bản xem trước cập nhật ngay.', 'Fill in the sections below — your preview updates live.')}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
        {/* ── FORM ── */}
        <div className="min-w-0 space-y-10">
          {/* Photos */}
          <Section title={t('Ảnh', 'Photos')} hint={t('Tối đa 6 ảnh. Ảnh đầu là ảnh bìa. Tin có ảnh được xem nhiều hơn hẳn.', 'Up to 6. The first is your cover. Listings with photos get far more views.')}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addPhotos(e.dataTransfer.files) }}
              className={cn('grid grid-cols-3 gap-2 rounded-2xl transition-colors sm:grid-cols-4', dragOver && 'ring-2 ring-[#0a66c2]/40')}
            >
              {photos.map((p, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-xl bg-tint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">{t('Bìa', 'Cover')}</span>}
                  <button aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-[#0a66c2] hover:text-accent-foreground">
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-[10px] font-semibold">{t('Thêm ảnh', 'Add')}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              )}
            </div>
          </Section>

          {/* Category & type */}
          <Section title={t('Danh mục', 'Category')} hint={t('Chọn đúng danh mục để người mua dễ tìm thấy.', 'Pick the right category so buyers find you.')}>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => chooseCategory(c.slug)}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', categorySlug === c.slug ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted')}
                >
                  <CategoryIcon name={c.icon} className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-accent-foreground')} />
                  {lang === 'vi' ? c.nameVi : c.name}
                </button>
              ))}
            </div>

            {categorySlug && typeOptions.length > 1 && (
              <Field label={t('Loại tin', 'Listing type')}>
                <Chips options={LISTING_TYPES.filter((lt) => typeOptions.includes(lt.value)).map((lt) => ({ value: lt.value, label: lang === 'vi' ? lt.labelVi : lt.label }))} value={listingType} onPick={setListingType} />
              </Field>
            )}
            {categorySlug && subOptions.length > 0 && (
              <Field label={t('Danh mục con', 'Subcategory')}>
                <Chips options={subOptions.map((s) => ({ value: s.slug, label: lang === 'vi' ? s.nameVi : s.name }))} value={subcategorySlug} onPick={(v) => setSubcategorySlug(v === subcategorySlug ? '' : v)} />
              </Field>
            )}
          </Section>

          {/* Details */}
          <Section title={t('Chi tiết', 'Details')}>
            <Field label={t('Tiêu đề', 'Title')} counter={`${title.length}/${TITLE_MAX}`}>
              <input
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('VD: iPhone 14 128GB — pin 92%', 'e.g. iPhone 14 128GB — battery 92%')}
                className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
              />
            </Field>
            <Field label={t('Mô tả', 'Description')} counter={`${description.length}/${DESC_MAX}`} hint={t('Tình trạng, lý do bán, điểm nổi bật. Đừng ghi số điện thoại.', 'Condition, why you’re selling, what stands out. No phone numbers.')}>
              <textarea
                value={description}
                maxLength={DESC_MAX}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder={t('Mô tả chi tiết…', 'Describe it in detail…')}
                className="w-full resize-none rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
              />
            </Field>
          </Section>

          {/* Specifics (condition + attributes) */}
          {categorySlug && (hasCondition || attrFacets.length > 0) && (
            <Section title={t('Thông số', 'Specifics')}>
              {hasCondition && (
                <Field label={t('Tình trạng', 'Condition')}>
                  <Chips options={[{ value: 'new', label: t('Mới', 'New') }, { value: 'used', label: t('Đã dùng', 'Used') }]} value={condition} onPick={setCondition} />
                </Field>
              )}
              {attrFacets.map((f) => (
                <Field key={f.key} label={lang === 'vi' ? f.labelVi : f.label}>
                  <Chips options={f.options.map((o) => ({ value: o.value, label: lang === 'vi' ? o.labelVi : o.label }))} value={attrs[f.key] || ''} onPick={(v) => setAttrs((prev) => ({ ...prev, [f.key]: prev[f.key] === v ? '' : v }))} />
                </Field>
              ))}
            </Section>
          )}

          {/* Price */}
          <Section title={t('Giá', 'Price')}>
            <div className="flex items-center gap-2">
              <div className="flex-1"><VndInput value={price} onChange={setPrice} placeholder={t('Nhập giá', 'Enter price')} /></div>
              {priceUnit && <span className="shrink-0 text-sm font-semibold text-ink-4">{priceUnit}</span>}
            </div>
            {showNegotiable && (
              <button onClick={() => setNegotiable((n) => !n)} className="mt-1 inline-flex items-center gap-2 text-sm text-body cursor-pointer">
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-md border transition-colors', negotiable ? 'border-[#0a66c2] bg-[#0a66c2] text-white' : 'border-line-strong')}>
                  {negotiable && <Check className="h-3.5 w-3.5" />}
                </span>
                {t('Có thể thương lượng', 'Price is negotiable')}
              </button>
            )}
          </Section>

          {/* Location */}
          <Section title={t('Khu vực', 'Location')}>
            <button
              type="button"
              ref={areaBtnRef}
              onClick={() => setAreaOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-sm text-left transition-colors hover:bg-muted"
            >
              <span className={cn('flex min-w-0 items-center gap-2', areaLabel ? 'text-foreground font-medium' : 'text-ink-4')}>
                <MapPin className="h-4 w-4 shrink-0 text-accent-foreground" />
                <span className="truncate">{areaLabel || t('Chọn khu vực — hoặc dùng vị trí của bạn', 'Set area — or use your location')}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" />
            </button>
          </Section>

          {/* Contact */}
          <Section title={t('Liên hệ', 'Contact')} hint={t('Số của bạn được giữ kín — người mua nhắn tin trong ứng dụng, chỉ hiện số sau khi bạn trả lời.', 'Your number stays private — buyers message you in-app; it’s revealed only after you reply.')}>
            {postingAs && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-accent-foreground" />
                {t('Đăng với tư cách', 'Posting as')} <span className="font-semibold text-foreground">{postingAs}</span>
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('Tên của bạn', 'Your name')}>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t('VD: Minh', 'e.g. Minh')} className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4" />
              </Field>
              <Field label={t('Số điện thoại / Zalo', 'Phone / Zalo')}>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" placeholder="0901 234 567" className="w-full rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4" />
              </Field>
            </div>
          </Section>

          {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
        </div>

        {/* ── PREVIEW + PUBLISH (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-4">{t('Xem trước', 'Live preview')}</span>
              <Preview cover={photos[0]?.url} title={title} price={price} priceUnit={priceUnit} area={areaLabel} categoryIcon={cat?.icon} negotiable={showNegotiable && negotiable} t={t} />
            </div>
            <PublishButton />
            {missing.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {checks.map((c) => (
                  <li key={c.key} className={cn('flex items-center gap-2 text-xs', c.ok ? 'text-ink-4 line-through' : 'text-body')}>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', c.ok ? 'text-emerald-600' : 'text-ink-4')}>
                      {c.ok ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-ink-4">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              {t('Tin hiển thị ngay. Số của bạn được giữ kín.', 'Goes live instantly. Your number stays private.')}
            </p>
          </div>
        </aside>
      </div>

      {/* Sticky publish bar (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto max-w-7xl"><PublishButton /></div>
      </div>

      <AreaFilter
        open={areaOpen}
        anchorRef={areaBtnRef}
        onClose={() => setAreaOpen(false)}
        province={province}
        ward={ward}
        nearby={nearby}
        onApply={({ province: p, ward: w, nearby: nb }) => { setProvince(p); setWard(w); setNearby(nb) }}
        onReset={() => { setProvince(null); setWard(null); setNearby(null) }}
      />
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="h-section text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, counter, hint, children }: { label: string; counter?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        {counter && <span className="text-[11px] text-ink-4">{counter}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Chips({ options, value, onPick }: { options: { value: string; label: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className={cn('rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', value === o.value ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Preview({ cover, title, price, priceUnit, area, categoryIcon, negotiable, t }: { cover?: string; title: string; price: string; priceUnit: string; area: string; categoryIcon?: string; negotiable: boolean; t: (vi: string, en: string) => string }) {
  return (
    <div className="w-full">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-tint">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CategoryIcon name={categoryIcon || ''} className="h-8 w-8 text-ink-4" />
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground">{title || t('Tiêu đề tin của bạn', 'Your listing title')}</h3>
      <p className="mt-0.5 text-sm font-bold text-foreground">
        {price ? formatMoneyFull(Number(price), '₫') : t('Giá', 'Price')}{price && priceUnit ? <span className="font-normal text-ink-4"> {priceUnit}</span> : null}
        {negotiable && <span className="ml-1 text-xs font-normal text-ink-4">· {t('Thương lượng', 'Negotiable')}</span>}
      </p>
      {area && <p className="text-xs text-muted-foreground">{area}</p>}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ImagePlus, X, ShieldCheck, MapPin, ChevronDown, Check, Lock, Sparkles, Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
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
import { subcategoriesFor, typesFor, facetsFor, rangeFacetsFor, categoryHasBrand, LISTING_TYPES } from '@/lib/taxonomy'
import { RangeSpecInput } from './range-spec-input'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadInBatches } from '@/lib/upload-client'
import { usePointerReorder } from '@/hooks/use-pointer-reorder'

const TITLE_MAX = 140
const DESC_MAX = 5000

export function PostWizard({ categories, embedded = false, onPosted }: { categories: SerializedCategory[]; embedded?: boolean; onPosted?: () => void }) {
  const { lang, tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous latch — `submitting` state only flips after the next render, so a
  // fast double-tap can fire submit() twice before disabled takes effect → two
  // listings + two social cross-posts. This ref blocks the second call immediately.
  const submittingRef = useRef(false)
  // AI assist (Gemini via Vertex — uses the GenAI credit). Gated by a public flag so
  // the ✨ buttons only appear once the server creds are set.
  const aiEnabled = process.env.NEXT_PUBLIC_AI_ASSIST === '1'
  const [aiBusy, setAiBusy] = useState<'photo' | 'desc' | null>(null)

  // ✨ Autofill category/subcategory/type/condition/title from the cover photo.
  const autofillFromPhoto = async () => {
    if (!photos.length || aiBusy) return
    setAiBusy('photo')
    try {
      const fd = new FormData()
      fd.append('file', photos[0].file)
      fd.append('lang', lang)
      const res = await fetch('/api/ai/classify', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (['decode_failed', 'no_file', 'empty_file', 'too_big'].includes(body.error)) {
          toast.error(t('Không đọc được ảnh này — thử ảnh JPG/PNG.', "Couldn't read that photo — try a JPG or PNG."))
          return
        }
        toast.error(aiErrMsg(body.error, res.status))
        return
      }
      const d = await res.json()
      if (d.unclear) {
        toast.error(t('Chưa thấy rõ sản phẩm — chụp cận cảnh chỉ riêng món đồ.', "Couldn't spot a clear product — take a close photo of just the item."))
        return
      }
      if (d.categorySlug) {
        setCategorySlug(d.categorySlug)
        setSubcategorySlug(d.subcategorySlug || '')
        setAttrs(d.attributes && typeof d.attributes === 'object' ? d.attributes : {})
        setRanges({})
        if (d.listingType) setListingType(d.listingType)
        if (d.condition) setCondition(d.condition)
        if (d.brand) setBrand(d.brand) // AI auto-selects the brand ONLY when confident
        if (d.model) setModel(d.model)
        if (d.title && !title.trim()) setTitle(d.title)
        // AI spec sheet (brand/model/key specs) → seed the description if empty.
        if (d.description && !description.trim()) setDescription(d.description)
        toast.success(t('Đã điền từ ảnh — kiểm tra lại nhé', 'Filled from your photo — double-check it'))
        // Couldn't confirm the brand → ask for a clearer logo photo rather than
        // filling a wrong guess. Non-blocking; the rest is already filled.
        if (d.brandUncertain) {
          toast(t('Chưa chắc thương hiệu — thêm ảnh rõ logo/nhãn để nhận diện chính xác.', 'Not sure of the brand — add a clear photo of the logo/label so we can identify it.'))
        }
      } else {
        toast.error(t('Không nhận diện được — chọn danh mục thủ công', "Couldn't read the photo — pick a category"))
      }
    } catch {
      toast.error(t('Không thể dùng AI lúc này', 'AI is unavailable right now'))
    } finally {
      setAiBusy(null)
    }
  }

  // ✨ Polish the description into professional copy (keeps the facts, your language).
  const polishDescription = async () => {
    if (description.trim().length < 3 || aiBusy) return
    setAiBusy('desc')
    try {
      const res = await fetch('/api/ai/rephrase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: description, lang }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(aiErrMsg(body.error, res.status))
        return
      }
      const d = await res.json()
      if (d.text) { setDescription(d.text); toast.success(t('Đã chỉnh lại mô tả', 'Polished your description')) }
    } catch {
      toast.error(t('Không thể dùng AI lúc này', 'AI is unavailable right now'))
    } finally {
      setAiBusy(null)
    }
  }
  // Specific AI failure messages — so "AI unavailable" no longer hides the real
  // cause (most often: not signed in on this device, or rate-limited).
  const aiErrMsg = (error?: string, status?: number) => {
    if (error === 'auth_required' || status === 401) return t('Đăng nhập để dùng AI', 'Sign in to use AI')
    if (error === 'rate_limited' || status === 429) return t('Bạn dùng AI hơi nhiều — thử lại sau ít phút', 'Too many AI requests — try again in a few minutes')
    return t('Không thể dùng AI lúc này', 'AI is unavailable right now')
  }
  const [error, setError] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [subcategorySlug, setSubcategorySlug] = useState('')
  const [listingType, setListingType] = useState('sell')
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  // Precise numeric specs (range facets: year/mileage/engine) → keyed by facet key.
  const [ranges, setRanges] = useState<Record<string, number | null>>({})
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [condition, setCondition] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  const [province, setProvince] = useState<Geo | null>(null)
  const [ward, setWard] = useState<Geo | null>(null)
  const [nearby, setNearby] = useState<Nearby | null>(null)
  const [locating, setLocating] = useState(false)
  // Quick "use my current location": geolocate → reverse-geocode → set the precise pin
  // (lat/lng) + the province/ward name for display + submit. No dropdown needed.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) { toast.error(t('Thiết bị không hỗ trợ định vị.', 'Location not available on this device.')); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude
        try {
          const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`)
          const d = await r.json()
          setNearby({ lat, lng, radiusKm: 5 })
          setProvince(d.province ? { code: '', name: d.province, nameEn: d.province } : null)
          setWard(d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null)
          toast.success(t('Đã dùng vị trí hiện tại', 'Using your current location'))
        } catch {
          setNearby({ lat, lng, radiusKm: 5 }) // keep the pin even if address lookup fails
        } finally { setLocating(false) }
      },
      () => { setLocating(false); toast.error(t('Không lấy được vị trí. Hãy cho phép truy cập vị trí và thử lại.', 'Could not get your location. Allow location access and try again.')) },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  const [photos, setPhotos] = useState<{ url: string; file: File }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [postingAs, setPostingAs] = useState<string | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)

  // Contact name + phone come from the ACCOUNT (not re-typed per post — a number is
  // unique per account). If the account is missing either, we prompt them to add it
  // in Settings first and block publishing.
  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((d) => {
      const u = d.user
      if (u) {
        setContactName(u.seller?.name || u.displayName || '')
        setContactPhone(u.seller?.phone || u.phone || '')
        if (u.accountType === 'business') setPostingAs(u.businessName || u.seller?.name || null)
      }
      setMeLoaded(true)
    }).catch(() => setMeLoaded(true))
  }, [])

  // Top brands for the datalist (suggestions only — free text creates new brands).
  // Fetched once when the user lands on a brand-relevant category.
  useEffect(() => {
    if (!categoryHasBrand(categorySlug) || brandOptions.length) return
    fetch('/api/brands?limit=120')
      .then((r) => r.json())
      .then((d) => setBrandOptions((d.brands || []).map((b: { name: string }) => b.name)))
      .catch(() => {})
  }, [categorySlug, brandOptions.length])

  const cat = categories.find((c) => c.slug === categorySlug)
  const subOptions = subcategoriesFor(categorySlug)
  const typeOptions = typesFor(categorySlug)
  const catFacets = facetsFor(categorySlug, subcategorySlug)
  const hasCondition = catFacets.some((f) => f.key === 'condition')
  const attrFacets = catFacets.filter((f) => f.key !== 'condition')
  const showBrand = categoryHasBrand(categorySlug)

  const chooseCategory = (slug: string) => {
    setCategorySlug(slug)
    setSubcategorySlug('')
    setAttrs({})
    setRanges({})
    setCondition('')
    if (!categoryHasBrand(slug)) { setBrand(''); setModel('') }
    setListingType(typesFor(slug)[0] ?? 'sell')
  }

  const phoneOk = contactPhone.replace(/\D/g, '').length >= 9
  const district = ward?.name || province?.name || ''
  const areaLabel = ward ? `${ward.name}${province ? `, ${province.name}` : ''}` : province ? province.name : (nearby ? t('Vị trí của bạn', 'Your location') : '')
  const hasLocation = !!(province || ward || nearby)
  const priceUnit = listingType === 'rent' || listingType === 'job' ? t('/ tháng', '/ month') : listingType === 'service' ? t('/ dịch vụ', '/ service') : ''

  // Required-field checklist (drives the Publish button + the "what's left" hint).
  const checks = [
    { key: 'photo', ok: photos.length >= 1, label: t('Thêm ảnh', 'Add a photo') },
    { key: 'category', ok: !!categorySlug, label: t('Chọn danh mục', 'Pick a category') },
    { key: 'title', ok: title.trim().length >= 3, label: t('Nhập tiêu đề', 'Add a title') },
    { key: 'price', ok: price.trim().length > 0, label: t('Nhập giá', 'Set a price') },
    { key: 'location', ok: hasLocation, label: t('Chọn khu vực', 'Set the area') },
    { key: 'contact', ok: contactName.trim().length >= 2 && phoneOk, label: t('Thêm liên hệ trong Cài đặt', 'Add name & phone in Settings') },
  ]
  const missing = checks.filter((c) => !c.ok)
  const canSubmit = missing.length === 0 && !submitting

  const [converting, setConverting] = useState(false)
  // Drag-to-reorder photos (touch + mouse) — index 0 is the cover.
  const movePhoto = (from: number, to: number) =>
    setPhotos((arr) => {
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
      const next = [...arr]
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  const { bind: bindPhoto } = usePointerReorder(movePhoto)
  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    // Accept images incl. HEIC/HEIF (which lack an image/* type on some browsers).
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
      .slice(0, 6 - photos.length)
    if (!incoming.length) return
    setConverting(true)
    try {
      for (const f of incoming) {
        try {
          // HEIC (iPhone) → JPEG + downscale/recompress in-browser so it previews,
          // uploads small (no 413 on big phone photos), and AI-reads cleanly.
          const norm = await compressImageFile(f)
          setPhotos((p) => [...p, { url: URL.createObjectURL(norm), file: norm }])
        } catch {
          toast.error(t('Không đọc được ảnh này.', "Couldn't read that photo."))
        }
      }
    } finally {
      setConverting(false)
    }
  }

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return
    if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsPhoneNumber(contactName)) {
      setError(t('Không được ghi số điện thoại trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng.', "Phone numbers aren't allowed in a listing — buyers message you in the app. Remove it to post."))
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      let imageUrls: string[] = []
      if (photos.length > 0) {
        // Photos are already compressed at add time; upload in small batches so the
        // request body never exceeds the serverless cap.
        imageUrls = await uploadInBatches(photos.map((p) => p.file))
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
          // Precise numeric specs → dedicated columns (year/mileageKm/engineL).
          ...Object.fromEntries(
            rangeFacetsFor(categorySlug, subcategorySlug)
              .filter((f) => ranges[f.key] != null)
              .map((f) => [f.range.column, ranges[f.key]]),
          ),
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          district: district || null,
          city: province?.name || null,
          location: ward?.name || province?.name || null,
          lat: nearby?.lat ?? null,
          lng: nearby?.lng ?? null,
          condition: hasCondition ? condition || null : null,
          brand: showBrand ? brand.trim() || null : null,
          model: showBrand ? model.trim() || null : null,
          images: imageUrls,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed')
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      trackPostListing({ id: created.id, title: title.trim(), price: Number(price), currency: 'VND', category: cat?.name || categorySlug, district: district || undefined })
      setSubmitted(true)
      onPosted?.() // embedded in dashboard → refresh listings + switch tab
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg === 'upload'
          ? t('Không tải được ảnh, vui lòng thử lại.', 'Could not upload your photos — please try again.')
          : msg === 'no_phone_in_listing'
          ? t('Không được ghi số điện thoại trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng.', "Phone numbers aren't allowed in a listing — buyers message you in the app. Remove it to post.")
          : msg === 'phone_taken'
          ? t('Số điện thoại này đã được một tài khoản khác sử dụng. Mỗi số chỉ dùng cho một tài khoản.', 'This phone number is already used by another account. Each number belongs to one account.')
          : t('Không gửi được, vui lòng thử lại.', 'Could not submit — please try again.'),
      )
      console.error(e)
    } finally {
      submittingRef.current = false
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
    <div className="pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-0">
      {!embedded && (
        <a href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors cursor-pointer">
          <ChevronLeft className="h-4 w-4" /> {t('Thoát', 'Exit')}
        </a>
      )}
      {!embedded && <h1 className="mt-3 h-display text-foreground">{t('Tạo tin đăng', 'Create a listing')}</h1>}
      <p className={cn('text-[15px] text-body', !embedded && 'mt-1')}>{t('Điền các mục bên dưới — bản xem trước cập nhật ngay.', 'Fill in the sections below — your preview updates live.')}</p>

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
                <div
                  key={i}
                  {...bindPhoto(i)}
                  className="group relative aspect-square cursor-move touch-none select-none overflow-hidden rounded-xl bg-tint"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
                  {i === 0 ? (
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0a66c2] px-1.5 py-0.5 text-[10px] font-bold text-white">{t('Bìa', 'Cover')}</span>
                  ) : (
                    <button type="button" onClick={() => movePhoto(i, 0)} className="absolute bottom-1 left-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer">{t('Đặt làm bìa', 'Make cover')}</button>
                  )}
                  <button aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-[#0a66c2] hover:text-accent-foreground">
                  {converting ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                  <span className="text-[10px] font-semibold">{converting ? t('Đang xử lý…', 'Processing…') : t('Thêm ảnh', 'Add')}</span>
                  <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              )}
            </div>
            {aiEnabled && photos.length > 0 && (
              <button
                type="button"
                onClick={autofillFromPhoto}
                disabled={!!aiBusy}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-1.5 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer"
              >
                {aiBusy === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t('Tự điền từ ảnh', 'Autofill from photo')}
              </button>
            )}
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
                  <CategoryIcon name={c.icon} className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-body')} />
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
            {showBrand && (
              <Field label={t('Thương hiệu', 'Brand')} hint={t('Giúp người mua tìm theo hãng. Bỏ trống nếu không có.', 'Helps buyers find you by brand. Leave blank if none.')}>
                <input
                  value={brand}
                  list="brand-options"
                  maxLength={40}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder={t('VD: Apple, Samsung, Honda', 'e.g. Apple, Samsung, Honda')}
                  className="w-full max-w-md rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                />
                <datalist id="brand-options">
                  {brandOptions.map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
            )}
            {showBrand && brand.trim() && (
              <Field label={t('Mẫu / Model', 'Model')} hint={t('VD: iPhone 14 Pro, Sorento. Giúp người mua lọc theo mẫu.', 'e.g. iPhone 14 Pro, Sorento. Lets buyers filter by model.')}>
                <input
                  value={model}
                  maxLength={60}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t('VD: iPhone 14 Pro', 'e.g. iPhone 14 Pro')}
                  className="w-full max-w-md rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
                />
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
                className="w-full max-w-2xl rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
              />
            </Field>
            <Field label={t('Mô tả', 'Description')} counter={`${description.length}/${DESC_MAX}`} hint={t('Tình trạng, lý do bán, điểm nổi bật. Đừng ghi số điện thoại.', 'Condition, why you’re selling, what stands out. No phone numbers.')}>
              {aiEnabled && (
                <div className="mb-1.5 flex max-w-2xl justify-end">
                  <button
                    type="button"
                    onClick={polishDescription}
                    disabled={!!aiBusy || description.trim().length < 3}
                    title={t('Viết lại chuyên nghiệp bằng AI', 'Rewrite professionally with AI')}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-accent-foreground transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer"
                  >
                    {aiBusy === 'desc' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {t('Chỉnh bằng AI', 'Polish with AI')}
                  </button>
                </div>
              )}
              <textarea
                value={description}
                maxLength={DESC_MAX}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder={t('Mô tả chi tiết…', 'Describe it in detail…')}
                className="w-full max-w-2xl resize-none rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4"
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
                  {f.kind === 'range' && f.range ? (
                    <RangeSpecInput range={f.range} value={ranges[f.key] ?? null} onChange={(v) => setRanges((prev) => ({ ...prev, [f.key]: v }))} />
                  ) : (
                    <Chips options={f.options.map((o) => ({ value: o.value, label: lang === 'vi' ? o.labelVi : o.label }))} value={attrs[f.key] || ''} onPick={(v) => setAttrs((prev) => ({ ...prev, [f.key]: prev[f.key] === v ? '' : v }))} />
                  )}
                </Field>
              ))}
            </Section>
          )}

          {/* Price */}
          <Section title={t('Giá', 'Price')}>
            <div className="flex max-w-xs items-center gap-2">
              <div className="flex-1"><VndInput value={price} onChange={setPrice} placeholder={t('Nhập giá', 'Enter price')} /></div>
              {priceUnit && <span className="shrink-0 text-sm font-semibold text-ink-4">{priceUnit}</span>}
            </div>
          </Section>

          {/* Location */}
          <Section title={t('Khu vực', 'Location')}>
            <div className="flex max-w-md items-center gap-2">
              <button
                type="button"
                ref={areaBtnRef}
                onClick={() => setAreaOpen((o) => !o)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-sm text-left transition-colors hover:bg-muted"
              >
                <span className={cn('flex min-w-0 items-center gap-2', areaLabel ? 'text-foreground font-medium' : 'text-ink-4')}>
                  <MapPin className="h-4 w-4 shrink-0 text-accent-foreground" />
                  <span className="truncate">{areaLabel || t('Chọn khu vực', 'Set area')}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" />
              </button>
              {/* Quick "use my current location" */}
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                aria-label={t('Dùng vị trí hiện tại', 'Use my current location')}
                title={t('Dùng vị trí hiện tại', 'Use my current location')}
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-tint text-accent-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
              </button>
            </div>
          </Section>

          {/* Contact — taken from your ACCOUNT (a number belongs to one account, so
              it isn't re-typed per post). Missing name/phone → add it in Settings. */}
          <Section title={t('Liên hệ', 'Contact')} hint={t('Số của bạn được giữ kín — người mua nhắn tin trong ứng dụng, chỉ hiện số sau khi bạn trả lời.', 'Your number stays private — buyers message you in-app; it’s revealed only after you reply.')}>
            {!meLoaded ? (
              <div className="h-5 w-56 rounded shimmer" />
            ) : contactName.trim().length >= 2 && phoneOk ? (
              <div className="space-y-1">
                {postingAs && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-accent-foreground" />
                    {t('Đăng với tư cách', 'Posting as')} <span className="font-semibold text-foreground">{postingAs}</span>
                  </p>
                )}
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{contactName}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="tabular-nums text-muted-foreground">{contactPhone}</span>
                </p>
                <a href="/dashboard?tab=account" className="inline-block text-xs font-bold text-accent-foreground hover:underline">
                  {t('Chỉnh sửa trong Cài đặt', 'Edit in Settings')}
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">{t('Thêm tên và số điện thoại trước khi đăng', 'Add your name and phone number before you can post')}</p>
                <p className="max-w-md text-xs text-body">{t('Thông tin liên hệ được lấy từ tài khoản của bạn — mỗi số chỉ dùng cho một tài khoản. Hãy thêm trong Cài đặt.', 'Your contact details come from your account — each number belongs to one account. Add them in Settings.')}</p>
                <a href="/dashboard?tab=account" className="inline-block text-sm font-bold text-accent-foreground hover:underline">
                  {t('Thêm trong Cài đặt', 'Add in Settings')} →
                </a>
              </div>
            )}
          </Section>

          {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
        </div>

        {/* ── PREVIEW + PUBLISH (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-4">{t('Xem trước', 'Live preview')}</span>
              <Preview cover={photos[0]?.url} title={title} price={price} priceUnit={priceUnit} area={areaLabel} categoryIcon={cat?.icon} t={t} />
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

      {/* Publish bar (mobile) — sits ABOVE the global fixed bottom-nav. bg runs to
          bottom-0 (so there's no gap when the nav auto-hides) while the button is
          padded up clear of the nav; the form root reserves matching space below so
          the last fields never hide behind it. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto max-w-7xl"><PublishButton /></div>
      </div>

      <AreaFilter
        mode="pick"
        hideLocate
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

function Preview({ cover, title, price, priceUnit, area, categoryIcon, t }: { cover?: string; title: string; price: string; priceUnit: string; area: string; categoryIcon?: string; t: (vi: string, en: string) => string }) {
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
      </p>
      {area && <p className="text-xs text-muted-foreground">{area}</p>}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ImagePlus, X, ShieldCheck, MapPin, ChevronDown, Check, Lock, Sparkles, Loader2, LocateFixed, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { SerializedCategory } from '@/lib/types'
import { CategoryIcon } from './category-icons'
import { ShareButton } from './share-button'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { haptic } from '@/lib/haptics'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord } from '@/lib/publish-guard'
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

// Rentable items live in a sale category (Vehicles/Property) OR the dedicated Rentals
// category. Choosing "For rent" moves a sale item into Rentals (and back), mapping the
// subcategory across — so AI's default-to-sale classification is one tap from rental.
const RENTABLE_SALE_CATS = new Set(['vehicles', 'property'])
const SALE_TO_RENT: Record<string, Record<string, string>> = {
  vehicles: { motorbike: 'motorbike-rental', car: 'car-rental', bicycle: 'bicycle-rental', 'ebike-scooter': 'ebike-rental' },
  property: { apartment: 'apartment-rental', house: 'house-rental', 'room-shared': 'room-rental' },
}
const RENT_TO_SALE: Record<string, { category: string; sub: string }> = {
  'motorbike-rental': { category: 'vehicles', sub: 'motorbike' },
  'car-rental': { category: 'vehicles', sub: 'car' },
  'bicycle-rental': { category: 'vehicles', sub: 'bicycle' },
  'ebike-rental': { category: 'vehicles', sub: 'ebike-scooter' },
  'apartment-rental': { category: 'property', sub: 'apartment' },
  'house-rental': { category: 'property', sub: 'house' },
  'room-rental': { category: 'property', sub: 'room-shared' },
}

// Data to PREFILL the wizard for editing an existing listing (Manage listings → Edit).
// Same shape the wizard collects, so editing is literally "post again" with values set.
export type ListingEditData = {
  id: string
  title: string
  description: string
  price: number
  negotiable: boolean
  urgent: boolean
  categorySlug: string
  subcategorySlug: string | null
  listingType: string
  condition: string | null
  brand: string | null
  model: string | null
  attributes: Record<string, string>
  year: number | null
  mileageKm: number | null
  engineL: number | null
  engineCc: number | null
  district: string | null
  city: string | null
  lat: number | null
  lng: number | null
  images: string[]
}

// Seed the range-facet state (keyed by facet key) from the listing's dedicated columns.
function initRangesFromEdit(edit?: ListingEditData): Record<string, number | null> {
  if (!edit) return {}
  const out: Record<string, number | null> = {}
  for (const f of rangeFacetsFor(edit.categorySlug, edit.subcategorySlug)) {
    const v = (edit as unknown as Record<string, unknown>)[f.range.column]
    if (typeof v === 'number') out[f.key] = v
  }
  return out
}

// Hoisted to module scope (not defined inside PostWizard's render) so React keeps a
// stable component identity — otherwise a new type is created every keystroke and the
// button subtree remounts on each parent re-render. Purely presentational; closes over
// nothing, everything it needs comes in as props.
function PublishButton({
  className,
  onSubmit,
  canSubmit,
  submitting,
  edit,
  missingCount,
  t,
}: {
  className?: string
  onSubmit: () => void
  canSubmit: boolean
  submitting: boolean
  edit: boolean
  missingCount: number
  t: (vi: string, en: string) => string
}) {
  return (
    <Button variant="cta" size="none"
      onClick={onSubmit}
      // NOT disabled when fields are missing — a click then reveals what's left
      // (disabled submit hides the reason). Only blocked mid-submit. `canSubmit`
      // still drives the label ("N left" vs "Publish").
      disabled={submitting}
      aria-disabled={!canSubmit}
      className={cn('w-full rounded-xl px-7 py-3 text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer', !canSubmit && !submitting && 'opacity-70', className)}
    >
      {submitting
        ? (edit ? t('Đang lưu…', 'Saving…') : t('Đang đăng…', 'Posting…'))
        : missingCount
        ? t(`Còn ${missingCount} mục`, `${missingCount} left to finish`)
        : (edit ? t('Lưu thay đổi', 'Save changes') : t('Đăng tin', 'Publish listing'))}
    </Button>
  )
}

export function PostWizard({ categories, embedded = false, onPosted, edit }: { categories: SerializedCategory[]; embedded?: boolean; onPosted?: () => void; edit?: ListingEditData }) {
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [submitted, setSubmitted] = useState(false)
  // Success-screen context: link to the live listing + a distinct first-ever moment.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [firstListing, setFirstListing] = useState(false)
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
    if (!user) { openSignIn(); return } // AI burns paid credits — members only
    const coverFile = photos[0]?.file
    if (!coverFile || aiBusy) return
    setAiBusy('photo')
    try {
      const fd = new FormData()
      fd.append('file', coverFile)
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
        // NOTE: intentionally do NOT auto-write the description. Sellers describe the
        // item in their OWN words (what actually matters — condition, quirks, why
        // selling), then optionally "Polish with AI" to tidy their own text.
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
    if (!user) { openSignIn(); return } // AI burns paid credits — members only
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
      if (d.text) setDescription(d.text)
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
  const [categorySlug, setCategorySlug] = useState(edit?.categorySlug ?? '')
  const [subcategorySlug, setSubcategorySlug] = useState(edit?.subcategorySlug ?? '')
  const [listingType, setListingType] = useState(edit?.listingType ?? 'sell')
  const [attrs, setAttrs] = useState<Record<string, string>>(edit?.attributes ?? {})
  // Precise numeric specs (range facets: year/mileage/engine) → keyed by facet key.
  const [ranges, setRanges] = useState<Record<string, number | null>>(() => initRangesFromEdit(edit))
  const [title, setTitle] = useState(edit?.title ?? '')
  const [description, setDescription] = useState(edit?.description ?? '')
  const [price, setPrice] = useState(edit ? String(edit.price) : '')
  // Price is open to offers by default (haggling norm); the seller can switch to a
  // FIXED price so buyers just ask availability + buy (no offer messages).
  const [negotiable, setNegotiable] = useState(edit?.negotiable ?? true)
  // Urgent sale ("Bán gấp") — server-gated (7-day window, re-arm cooldown, 2/seller).
  const [urgent, setUrgent] = useState(edit?.urgent ?? false)
  const [condition, setCondition] = useState(edit?.condition ?? '')
  const [brand, setBrand] = useState(edit?.brand ?? '')
  const [model, setModel] = useState(edit?.model ?? '')
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  const [province, setProvince] = useState<Geo | null>(edit?.city ? { code: '', name: edit.city, nameEn: edit.city } : null)
  const [ward, setWard] = useState<Geo | null>(edit?.district ? { code: '', name: edit.district, nameEn: edit.district } : null)
  const [nearby, setNearby] = useState<Nearby | null>(edit?.lat != null && edit?.lng != null ? { lat: edit.lat, lng: edit.lng, radiusKm: 5 } : null)
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
          const d = r.ok ? await r.json().catch(() => ({})) : {}
          setNearby({ lat, lng, radiusKm: 5 })
          if (d.province || d.ward) {
            setProvince(d.province ? { code: '', name: d.province, nameEn: d.province } : null)
            setWard(d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null)
          } else {
            // Pin kept, but the address lookup returned nothing — don't claim success on a name.
          }
        } catch {
          setNearby({ lat, lng, radiusKm: 5 }) // keep the pin even if address lookup fails
        } finally { setLocating(false) }
      },
      () => { setLocating(false); toast.error(t('Không lấy được vị trí. Hãy cho phép truy cập vị trí và thử lại.', 'Could not get your location. Allow location access and try again.')) },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  // In edit mode, existing images seed as URL-only entries (no File); new uploads add a
  // File. Submit uploads only the File ones and keeps the URL ones (preserving order).
  const [photos, setPhotos] = useState<{ url: string; file?: File }[]>(() => edit?.images?.map((url) => ({ url })) ?? [])
  const [dragOver, setDragOver] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [editingPhone, setEditingPhone] = useState(false) // quick-edit the contact number inline
  const [postingAs, setPostingAs] = useState<string | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)

  // ── Draft autosave (new listings only; photos aren't persisted). Crash
  // insurance, not a drafts feature: restores only within a short window
  // (industry norm — protect against accidental close, don't resurrect stale
  // intent), and only when real typing happened. A category tap alone is not a
  // draft; anything older than the TTL is silently deleted. ──
  const DRAFT_TTL_MS = 15 * 60_000
  const draftHydrated = useRef(false)
  useEffect(() => {
    if (edit) { draftHydrated.current = true; return }
    try {
      const d = JSON.parse(localStorage.getItem('eno-listing-draft') || 'null')
      const meaningful = d && (d.title?.trim() || d.description?.trim() || d.price)
      const fresh = d && Date.now() - (d.savedAt || 0) < DRAFT_TTL_MS
      if (d && !(meaningful && fresh)) localStorage.removeItem('eno-listing-draft')
      if (d && meaningful && fresh) {
        if (d.categorySlug != null) setCategorySlug(d.categorySlug)
        if (d.subcategorySlug != null) setSubcategorySlug(d.subcategorySlug)
        if (d.listingType) setListingType(d.listingType)
        if (d.attrs) setAttrs(d.attrs)
        if (d.ranges) setRanges(d.ranges)
        if (d.title) setTitle(d.title)
        if (d.description) setDescription(d.description)
        if (d.price) setPrice(d.price)
        if (typeof d.negotiable === 'boolean') setNegotiable(d.negotiable)
        if (typeof d.urgent === 'boolean') setUrgent(d.urgent)
        if (d.condition) setCondition(d.condition)
        if (d.brand) setBrand(d.brand)
        if (d.model) setModel(d.model)
        if (d.province) setProvince(d.province)
        if (d.ward) setWard(d.ward)
        if (d.nearby) setNearby(d.nearby)
        toast.success(t('Đã khôi phục bản nháp — thêm lại ảnh nhé', 'Draft restored — re-add your photos'))
      }
    } catch {}
    draftHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit])
  useEffect(() => {
    if (edit || !draftHydrated.current) return
    try {
      // Only typed work is worth keeping — clicking around the form isn't.
      if (!title.trim() && !description.trim() && !price) {
        localStorage.removeItem('eno-listing-draft')
        return
      }
      localStorage.setItem('eno-listing-draft', JSON.stringify({ savedAt: Date.now(), categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby }))
    } catch {}
  }, [edit, categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby])

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
    // re-runs when a guest signs in mid-wizard (draft-first posting) so the
    // account's name/phone land without a reload.
  }, [user])

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

  // Sale-vs-rent quick switch for rentable items (Vehicles/Property ↔ Rentals). AI
  // defaults rentable items to a sale category; one tap flips the WHOLE category to
  // Rentals (mapping the subcategory), so "this is actually a rental" just works.
  const intent: 'sell' | 'rent' = categorySlug === 'rentals' ? 'rent' : 'sell'
  const showRentToggle = !edit && (categorySlug === 'rentals' || RENTABLE_SALE_CATS.has(categorySlug))
  const switchIntent = (to: 'sell' | 'rent') => {
    if (to === intent) return
    if (to === 'rent') {
      setSubcategorySlug(SALE_TO_RENT[categorySlug]?.[subcategorySlug] ?? '')
      setCategorySlug('rentals')
      setListingType('rent')
    } else {
      const map = RENT_TO_SALE[subcategorySlug]
      setCategorySlug(map?.category ?? 'property') // stays/homestays w/o a sale twin → Property
      setSubcategorySlug(map?.sub ?? '')
      setListingType('sell')
    }
    // Facets differ across sale ↔ rentals → reset attribute/range/condition state.
    setAttrs({}); setRanges({}); setCondition('')
  }

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
  // Draft-first posting: anyone can fill the wizard; auth is asked at Publish
  // (and for the AI buttons, which burn paid credits).
  const isGuest = !authLoading && !user
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
    // Guests (draft-first posting): contact comes from the account AFTER the
    // sign-in that submit() triggers — don't block the button on it here.
    isGuest
      ? { key: 'signin', ok: true, label: t('Đăng nhập để đăng tin', 'Sign in to publish') }
      : { key: 'contact', ok: contactName.trim().length >= 2 && phoneOk, label: t('Thêm tên & SĐT của bạn', 'Add your name & phone') },
  ]
  const missing = checks.filter((c) => !c.ok)
  const canSubmit = missing.length === 0 && !submitting

  // On-blur inline validation for the high-traffic fields — errors surface as the
  // user leaves a field, not only on submit (says what's wrong + how to fix).
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const touch = (k: string) => setTouched((p) => (p[k] ? p : { ...p, [k]: true }))
  // "Attempted": the user pressed Publish while something was missing → flag EVERY
  // unfilled required field in red at once so they can be spotted at a glance
  // (GOV.UK/Nielsen: don't disable submit — validate on submit + highlight). Per-
  // field flags clear the instant a field is filled, so the red recedes as they go.
  const [attempted, setAttempted] = useState(false)
  const err = {
    photo: attempted && photos.length < 1,
    category: attempted && !categorySlug,
    title: (touched.title || attempted) && title.trim().length < 3,
    price: (touched.price || attempted) && price.trim().length === 0,
    location: attempted && !hasLocation,
    contact: attempted && !isGuest && !(contactName.trim().length >= 2 && phoneOk),
  }
  const titleErr = err.title
    ? (title.trim().length === 0 ? t('Hãy nhập tiêu đề', 'Add a title') : t('Tiêu đề cần tối thiểu 3 ký tự', 'Title needs at least 3 characters'))
    : undefined
  const priceErr = err.price ? t('Hãy nhập giá', 'Set a price') : undefined
  // Jump to (and focus) the first still-missing field when a publish attempt fails.
  const scrollToMissing = () => {
    const first = missing[0]
    if (!first) return
    const el = document.getElementById(`pw-${first.key}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true })
  }

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
    if (submittingRef.current || submitting) return
    // Missing required fields → don't silently no-op: flag them all in red and jump
    // to the first so the user sees exactly what's left.
    if (missing.length > 0) { setAttempted(true); scrollToMissing(); return }
    // Catch fixable issues client-side so they're noted BEFORE submitting (the server
    // enforces the same rules). Contact info / addresses stay off the public listing —
    // buyers reach sellers in-app.
    const blob = `${title} ${description} ${contactName}`
    if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsPhoneNumber(contactName) || containsContactInfo(blob)) {
      setError(t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post."))
      return
    }
    if (findBannedWord(blob)) {
      setError(t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again."))
      return
    }
    // Draft-first: the listing is ready — NOW ask for the account. The text draft
    // is already in localStorage (survives an OAuth redirect); in-dialog OTP/email
    // keeps photos too. After sign-in the /api/me effect fills contact info.
    if (!user) {
      openSignIn()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      // Upload only NEW photos (those with a File); keep already-hosted URLs (edit mode)
      // in their original order so the cover + sequence are preserved.
      const toUpload = photos.filter((p) => p.file)
      const uploaded = toUpload.length ? await uploadInBatches(toUpload.map((p) => p.file!)) : []
      if (uploaded.length < toUpload.length) throw new Error('upload')
      let ui = 0
      const imageUrls = photos.map((p) => (p.file ? uploaded[ui++] : p.url))

      const payload = {
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
        negotiable,
        urgent,
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
      }
      // Edit → PATCH the existing listing; new post → POST.
      const res = await fetch(edit ? `/api/listings/${edit.id}` : '/api/listings', {
        method: edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed')
      if (edit) {
        // landing on the updated listing IS the confirmation
        router.push(`/listings/${edit.id}`)
        return
      }
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      trackPostListing({ id: created.id, title: title.trim(), price: Number(price), currency: 'VND', category: cat?.name || categorySlug, district: district || undefined })
      try { localStorage.removeItem('eno-listing-draft') } catch {}
      // First-ever publish gets a distinct celebration moment on the success
      // screen (device-local flag — celebration-grade accuracy is fine).
      try {
        setFirstListing(!localStorage.getItem('eno-posted-before'))
        localStorage.setItem('eno-posted-before', '1')
      } catch {}
      setCreatedId(created.id ?? null)
      haptic(18)
      setSubmitted(true)
      onPosted?.() // embedded in dashboard → refresh listings + switch tab
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg === 'upload'
          ? t('Không tải được ảnh, vui lòng thử lại.', 'Could not upload your photos — please try again.')
          : msg === 'no_phone_in_listing' || msg === 'contact_in_text'
          ? t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post.")
          : msg === 'banned_words'
          ? t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again.")
          : msg === 'urgent_quota'
          ? t('Bạn đã có 2 tin "Bán gấp" đang chạy — chờ một tin hết hạn rồi thử lại.', 'You already have 2 urgent listings running — wait for one to expire and try again.')
          : msg === 'urgent_cooldown'
          ? t('Tin này vừa hết hạn "Bán gấp" — có thể bật lại sau 7 ngày.', 'This listing just finished an urgent run — you can turn it on again after 7 days.')
          : msg === 'photo_required'
          ? t('Cần ít nhất một ảnh để đăng tin.', 'You need at least one photo to post.')
          : msg === 'account_restricted'
          ? t('Tài khoản của bạn đang bị hạn chế do điểm uy tín thấp. Bạn có thể đăng lại khi điểm uy tín phục hồi.', "Your account is restricted due to a low trust score. You can post again once your trust score recovers.")
          : msg === 'account_held'
          ? t('Tin đăng của bạn đang tạm dừng trong khi chúng tôi xem xét một báo cáo — xem chi tiết và khiếu nại trong trang quản lý.', 'Your listings are paused while we review a report — see your dashboard for details and to appeal.')
          : msg === 'account_suspended'
          ? t('Tài khoản của bạn đang tạm ngưng nên chưa thể đăng tin — xem chi tiết trong trang quản lý.', 'Your account is suspended, so posting is paused — see your dashboard for details.')
          : msg === 'probation_listing_cap'
          ? t('Tài khoản mới có thể giữ tối đa 8 tin đang đăng — hãy đánh dấu đã bán một tin, hoặc chờ tài khoản đủ 30 ngày.', 'New accounts can keep up to 8 active listings — mark something sold or wait until your account is 30 days old.')
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
    // Peak-motivation moment — never a dead end: view it, share it, then manage it.
    // A first-ever publish gets its own (calm) celebration copy.
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Mascot name="success" className="h-52 w-52" />
        <h1 className="h-title text-foreground">
          {firstListing ? t('Tin đầu tiên của bạn đã lên sóng! 🎉', 'Your first listing is live! 🎉') : t('Tin của bạn đã được đăng!', 'Your listing is live!')}
        </h1>
        <p className="max-w-md text-sm text-body">
          {t('Tin của bạn đã hiển thị công khai. Người mua sẽ nhắn tin cho bạn ngay trong ứng dụng — số điện thoại của bạn được giữ kín cho đến khi bạn trả lời.', 'It’s now visible to buyers. They’ll message you in-app — your number stays private until you reply.')}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {createdId && (
            <a href={`/listings/${createdId}`} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
              {t('Xem tin của bạn', 'View your listing')}
            </a>
          )}
          {createdId && (
            <ShareButton
              url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/listings/${createdId}`}
              title={title.trim()}
              price={Number(price) || undefined}
              currency="₫"
            />
          )}
        </div>
        <a href="/dashboard" className="text-sm font-semibold text-accent-foreground hover:underline">
          {t('Tới bảng điều khiển', 'Go to dashboard')}
        </a>
      </div>
    )
  }

  const publishButtonProps = {
    onSubmit: submit,
    canSubmit,
    submitting,
    edit: !!edit,
    missingCount: missing.length,
    t,
  }

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
          <Section id="pw-photo" title={t('Ảnh', 'Photos')} hint={t('Tối đa 6 ảnh. Ảnh đầu là ảnh bìa. Tin có ảnh được xem nhiều hơn hẳn.', 'Up to 6. The first is your cover. Listings with photos get far more views.')}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addPhotos(e.dataTransfer.files) }}
              className={cn('grid grid-cols-3 gap-2 rounded-2xl transition-colors sm:grid-cols-4', dragOver && 'ring-2 ring-brand/40', err.photo && 'p-2 -m-2 ring-2 ring-red-500/60')}
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
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{t('Bìa', 'Cover')}</span>
                  ) : (
                    <button type="button" onClick={() => movePhoto(i, 0)} className="absolute bottom-1 left-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer">{t('Đặt làm bìa', 'Make cover')}</button>
                  )}
                  <button aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))] tap-44">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-brand hover:text-accent-foreground">
                  {converting ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                  <span className="text-[10px] font-semibold">{converting ? t('Đang xử lý…', 'Processing…') : t('Thêm ảnh', 'Add')}</span>
                  <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              )}
            </div>
            {err.photo && <p role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{t('Thêm ít nhất 1 ảnh', 'Add at least one photo')}</p>}
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
          <Section id="pw-category" title={t('Danh mục', 'Category')} hint={t('Chọn đúng danh mục để người mua dễ tìm thấy.', 'Pick the right category so buyers find you.')}>
            {showRentToggle && (
              <Field label={t('Bán hay cho thuê?', 'For sale or for rent?')}>
                <div className="inline-flex rounded-xl bg-tint p-1">
                  {(['sell', 'rent'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => switchIntent(v)}
                      className={cn('rounded-lg px-4 py-1.5 text-sm font-bold transition-colors cursor-pointer', intent === v ? 'bg-primary text-white' : 'text-body hover:text-foreground')}
                    >
                      {v === 'sell' ? t('Bán', 'For sale') : t('Cho thuê', 'For rent')}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {edit ? (
              // Category is fixed when editing (changing it would re-derive subcategory/
              // brand/facets). To switch category, delete + repost.
              <div className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3.5 py-2 text-sm font-semibold text-body">
                {cat && <CategoryIcon name={cat.icon} className="h-4 w-4 text-body" />}
                {cat ? tr(cat.name, cat.nameVi) : categorySlug}
                <span className="ml-1 text-xs font-normal text-ink-4">{t('(không đổi khi sửa)', '(fixed when editing)')}</span>
              </div>
            ) : (
              <>
                <div className={cn('flex flex-wrap gap-2 rounded-xl transition-colors', err.category && 'p-2 -m-2 ring-2 ring-red-500/60')}>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => chooseCategory(c.slug)}
                      className={cn('inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', categorySlug === c.slug ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
                    >
                      <CategoryIcon name={c.icon} className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-body')} />
                      {tr(c.name, c.nameVi)}
                    </button>
                  ))}
                </div>
                {err.category && <p role="alert" className="text-xs font-semibold text-red-600">{t('Chọn một danh mục', 'Pick a category')}</p>}
              </>
            )}

            {categorySlug && typeOptions.length > 1 && (
              <Field label={t('Loại tin', 'Listing type')}>
                <Chips options={LISTING_TYPES.filter((lt) => typeOptions.includes(lt.value)).map((lt) => ({ value: lt.value, label: tr(lt.label, lt.labelVi) }))} value={listingType} onPick={setListingType} />
              </Field>
            )}
            {categorySlug && subOptions.length > 0 && (
              <Field label={t('Danh mục con', 'Subcategory')}>
                <Chips options={subOptions.map((s) => ({ value: s.slug, label: tr(s.name, s.nameVi) }))} value={subcategorySlug} onPick={(v) => setSubcategorySlug(v === subcategorySlug ? '' : v)} />
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
            <Field label={t('Tiêu đề', 'Title')} counter={`${title.length}/${TITLE_MAX}`} error={titleErr}>
              <input
                id="pw-title"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => touch('title')}
                placeholder={t('VD: iPhone 14 128GB — pin 92%', 'e.g. iPhone 14 128GB — battery 92%')}
                className={cn('w-full max-w-2xl rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4', err.title && 'ring-2 ring-red-500/60')}
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
                <Field key={f.key} label={tr(f.label, f.labelVi)}>
                  {f.kind === 'range' && f.range ? (
                    <RangeSpecInput range={f.range} value={ranges[f.key] ?? null} onChange={(v) => setRanges((prev) => ({ ...prev, [f.key]: v }))} />
                  ) : (
                    <Chips options={f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))} value={attrs[f.key] || ''} onPick={(v) => setAttrs((prev) => ({ ...prev, [f.key]: prev[f.key] === v ? '' : v }))} />
                  )}
                </Field>
              ))}
            </Section>
          )}

          {/* Price */}
          <Section id="pw-price" title={t('Giá', 'Price')}>
            <div onBlur={() => touch('price')}>
              <div className="flex max-w-xs items-center gap-2">
                <div className="flex-1"><VndInput id="pw-price-input" value={price} onChange={setPrice} placeholder={t('Nhập giá', 'Enter price')} invalid={err.price} /></div>
                {priceUnit && <span className="shrink-0 text-sm font-semibold text-ink-4">{priceUnit}</span>}
              </div>
              {priceErr && <p role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{priceErr}</p>}
              {/* Negotiable vs fixed — a fixed price hides the offer UI so buyers just
                  ask availability and buy directly (seller's convenience). Fixed price
                  also switches off Urgent: urgency promises flexibility. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { val: true, label: t('Có thể trả giá', 'Negotiable'), hint: t('Người mua có thể trả giá', 'Buyers can send offers') },
                  { val: false, label: t('Giá cố định', 'Fixed price'), hint: t('Không nhận trả giá', 'No offers — ask & buy directly') },
                ].map((opt) => (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => { setNegotiable(opt.val); if (!opt.val) setUrgent(false) }}
                    aria-pressed={negotiable === opt.val}
                    className={cn(
                      'rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
                      negotiable === opt.val ? 'bg-[#0a66c2] text-white' : 'bg-tint text-body hover:bg-muted',
                    )}
                  >
                    {opt.label}
                    <span className={cn('block text-xs font-medium', negotiable === opt.val ? 'text-white/80' : 'text-ink-4')}>{opt.hint}</span>
                  </button>
                ))}
              </div>
              {/* Urgent sale ("Bán gấp") — free, 7 days, auto-expires. Selecting it
                  force-enables offers (the server enforces the same coupling). Orange
                  = its badge color on cards, distinct from the blue selections. */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => { const next = !urgent; setUrgent(next); if (next) setNegotiable(true) }}
                  aria-pressed={urgent}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
                    urgent ? 'bg-orange-700 text-white' : 'bg-tint text-body hover:bg-muted',
                  )}
                >
                  <Zap className={cn('h-4 w-4 shrink-0', urgent && 'fill-current')} />
                  <span>
                    {t('Bán gấp', 'Urgent sale')}
                    <span className={cn('block text-xs font-medium', urgent ? 'text-white/80' : 'text-ink-4')}>
                      {t('Nổi bật 7 ngày — cần bán nhanh, sẵn sàng nhận trả giá', 'Highlighted for 7 days — sell fast, open to offers')}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </Section>

          {/* Location */}
          <Section id="pw-location" title={t('Khu vực', 'Location')}>
            <div className="flex max-w-md items-center gap-2">
              <button
                type="button"
                ref={areaBtnRef}
                onClick={() => setAreaOpen((o) => !o)}
                className={cn('flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-sm text-left transition-colors hover:bg-muted', err.location && 'ring-2 ring-red-500/60')}
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
            {err.location && <p role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{t('Chọn khu vực', 'Set the area')}</p>}
          </Section>

          {/* Contact — taken from your ACCOUNT (a number belongs to one account, so
              it isn't re-typed per post). Missing name/phone → add it in Settings. */}
          <Section id="pw-contact" title={t('Liên hệ', 'Contact')} hint={t('Số của bạn được giữ kín — người mua nhắn tin trong ứng dụng, chỉ hiện số sau khi bạn trả lời.', 'Your number stays private — buyers message you in-app; it’s revealed only after you reply.')}>
            {!meLoaded ? (
              <div className="h-5 w-56 rounded shimmer" />
            ) : isGuest ? (
              // Draft-first guests: contact comes from the account they'll sign in
              // with at Publish — no fields to type here.
              <p className="text-sm text-muted-foreground">
                {t('Tên và số điện thoại lấy từ tài khoản của bạn khi đăng nhập lúc đăng tin.', 'Your name & number come from your account when you sign in at publish.')}
              </p>
            ) : (
              <div className="space-y-3">
                {postingAs && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-accent-foreground" />
                    {t('Đăng với tư cách', 'Posting as')} <span className="font-semibold text-foreground">{postingAs}</span>
                  </p>
                )}

                {/* Name — inline-editable if it's not set on the account yet. */}
                {contactName.trim().length >= 2 ? (
                  <p className="text-sm font-semibold text-foreground">{contactName}</p>
                ) : (
                  <Field label={t('Tên của bạn', 'Your name')} error={err.contact && contactName.trim().length < 2 ? t('Thêm tên của bạn', 'Add your name') : undefined}>
                    <input
                      value={contactName}
                      maxLength={80}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder={t('Tên hiển thị cho người mua', 'Name buyers will see')}
                      className={cn('w-full max-w-md rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4', err.contact && contactName.trim().length < 2 && 'ring-2 ring-red-500/60')}
                    />
                  </Field>
                )}

                {/* Phone — quick-edit inline (no trip to Settings). Shows the saved number
                    with a "Change" toggle; an input when it's missing or being edited. */}
                {!editingPhone && phoneOk ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{contactPhone}</span>
                    <button type="button" onClick={() => setEditingPhone(true)} className="text-xs font-bold text-accent-foreground hover:underline cursor-pointer">
                      {t('Đổi số', 'Change number')}
                    </button>
                  </div>
                ) : (
                  <Field label={t('Số điện thoại', 'Phone number')} hint={t('Người mua không thấy số cho đến khi bạn trả lời.', 'Buyers never see it until you reply.')} error={err.contact && !phoneOk ? t('Thêm số điện thoại hợp lệ', 'Add a valid phone number') : undefined}>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+84…"
                      className={cn('w-full max-w-md rounded-xl bg-tint px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4', err.contact && !phoneOk && 'ring-2 ring-red-500/60')}
                    />
                    {/* Zalo OTP verification is BUILT but hidden until Zalo is live —
                        no dead "coming soon" buttons on the posting path. */}
                  </Field>
                )}

                <a href="/dashboard?tab=account" className="inline-block text-xs font-bold text-accent-foreground hover:underline">
                  {t('Chỉnh sửa trong Cài đặt', 'Edit in Settings')}
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
            <PublishButton {...publishButtonProps} />
            {missing.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {checks.map((c) => (
                  <li key={c.key} className={cn('flex items-center gap-2 text-xs', c.ok ? 'text-ink-4 line-through' : 'text-body')}>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', c.ok ? 'text-success' : 'text-ink-4')}>
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
      <div data-fab-clear className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto max-w-7xl space-y-2">
          {/* What's still missing — mobile parity with the desktop checklist */}
          {missing.length > 0 && (
            <p className="truncate text-[11px] font-semibold text-ink-4">
              {t('Còn thiếu', 'Still needed')}: {missing.map((c) => c.label).join(' · ')}
            </p>
          )}
          <PublishButton {...publishButtonProps} />
        </div>
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

function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <div>
        <h2 className="h-section text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, counter, hint, error, children }: { label: string; counter?: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        {counter && <span className="text-[11px] text-ink-4">{counter}</span>}
      </div>
      {children}
      {error ? <p role="alert" className="text-xs font-semibold text-red-600">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
          className={cn('rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', value === o.value ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
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
      <div className="relative aspect-[6/7] w-full overflow-hidden rounded-xl bg-tint">
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

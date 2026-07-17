'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ImagePlus, X, ShieldCheck, MapPin, ChevronDown, Check, Lock, Sparkles, Loader2, LocateFixed, Zap, Video } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { toast } from 'sonner'
import type { SerializedCategory } from '@/lib/types'
import { CategoryIcon } from './category-icons'
import { ShareButton } from './share-button'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldControl } from '@/components/ui/field'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import { haptic } from '@/lib/haptics'
import { isNativeApp } from '@/lib/native-auth'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord } from '@/lib/publish-guard'
import { trackPostListing } from '@/lib/analytics'
import { VndInput } from './vnd-input'
import { AreaFilter, type Geo, type Nearby } from './area-filter'
import { Mascot } from './mascot'
import { moneyLocale, compactPrice } from '@/lib/vnd'
import { subcategoriesFor, typesFor, facetsFor, rangeFacetsFor, categoryHasBrand, LISTING_TYPES } from '@/lib/taxonomy'
import { RangeSpecInput } from './range-spec-input'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadInBatches } from '@/lib/upload-client'
import { usePointerReorder } from '@/hooks/use-pointer-reorder'
import { PublishButton, Section, Field, Chips, Preview } from './post-wizard-parts'

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
  video: string | null
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
  // Optional single video: url-only in edit mode (already hosted); a new pick carries a File
  // + a blob: preview URL. ≤60s (duration-gated client-side) — autoplays on hover + in the feed.
  const [video, setVideo] = useState<{ url: string; file?: File; hevc?: boolean } | null>(() => (edit?.video ? { url: edit.video } : null))
  const [videoBusy, setVideoBusy] = useState(false)
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

  // Market-price guidance for the price step — the same PriceStat band the PDP's
  // "Market price" module shows (n≥5 + spread suppression live server-side).
  // Debounced + stale-cancelled; best-effort: any miss/error just hides the box.
  const [priceBand, setPriceBand] = useState<{ n: number; p25: number; median: number; p75: number } | null>(null)
  const bandYear = ranges['year'] ?? null
  useEffect(() => {
    // rentals price per MONTH — the PriceStat bands are sale prices, so guidance
    // there would coach sellers against the wrong market. Skip entirely.
    if (!categoryHasBrand(categorySlug) || categorySlug === 'rentals' || brand.trim().length < 2 || !model.trim()) { setPriceBand(null); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ brand: brand.trim(), model: model.trim() })
      if (condition) qs.set('condition', condition)
      if (bandYear != null) qs.set('year', String(bandYear))
      fetch(`/api/price-guidance?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPriceBand(d && d.n >= 5 ? d : null))
        .catch(() => { if (!ctrl.signal.aborted) setPriceBand(null) })
    }, 400)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [categorySlug, brand, model, condition, bandYear])

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
    { key: 'photo', ok: photos.length >= 3, label: t('Thêm 3 ảnh', 'Add 3 photos') },
    { key: 'category', ok: !!categorySlug, label: t('Chọn danh mục', 'Pick a category') },
    { key: 'title', ok: title.trim().length >= 3, label: t('Nhập tiêu đề', 'Add a title') },
    // Details are REQUIRED (user decision 2026-07-14): listings without a real
    // description or specifics read as low-effort/scammy and stall in chat with
    // "is it new? what year?" — make sellers answer once, up front.
    { key: 'description', ok: description.trim().length >= 20, label: t('Viết mô tả (ít nhất 20 ký tự)', 'Write a description (at least 20 characters)') },
    ...(hasCondition ? [{ key: 'condition', ok: !!condition, label: t('Chọn tình trạng', 'Pick the condition') }] : []),
    ...(attrFacets.some((f) => f.kind !== 'range')
      ? [{ key: 'details', ok: attrFacets.filter((f) => f.kind !== 'range').every((f) => !!attrs[f.key]), label: t('Điền thông số', 'Fill in the specifics') }]
      : []),
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
    photo: attempted && photos.length < 3,
    category: attempted && !categorySlug,
    title: (touched.title || attempted) && title.trim().length < 3,
    // The 20-char minimum BLOCKS publish (see `checks`) but used to render no message at
    // all — the seller was bounced by a rule the form never stated.
    description: (touched.description || attempted) && description.trim().length < 20,
    price: (touched.price || attempted) && price.trim().length === 0,
    location: attempted && !hasLocation,
    // Name and phone are TWO fields. One shared `contact` flag lit both of them red when
    // only one was wrong — and pointed the screen reader at the wrong one.
    contactName: attempted && !isGuest && contactName.trim().length < 2,
    contactPhone: attempted && !isGuest && !phoneOk,
  }
  const titleErr = err.title
    ? (title.trim().length === 0 ? t('Hãy nhập tiêu đề', 'Add a title') : t('Tiêu đề cần tối thiểu 3 ký tự', 'Title needs at least 3 characters'))
    : undefined
  const descErr = err.description
    ? (description.trim().length === 0 ? t('Hãy viết mô tả — ít nhất 20 ký tự', 'Add a description — at least 20 characters') : t('Mô tả cần tối thiểu 20 ký tự', 'Description needs at least 20 characters'))
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
  const { bind: bindPhoto, dragging: draggingPhoto } = usePointerReorder(movePhoto)
  // Native camera/gallery (Capacitor): tap "Add" in the app → a native action sheet (Take Photo /
  // Choose from Library) → @capacitor/camera returns image(s) we turn into Files and feed to the
  // SAME addPhotos pipeline (HEIC→JPEG compress, preview, upload). Falls through to the web file
  // input on the web. Camera + photo-library usage strings live in Info.plist / AndroidManifest.
  const pickNativePhotos = async () => {
    const remaining = 6 - photos.length
    if (remaining <= 0) return
    const toFile = async (webPath: string, i: number): Promise<File> => {
      const blob = await (await fetch(webPath)).blob()
      return new File([blob], `photo-${Date.now()}-${i}.jpg`, { type: blob.type || 'image/jpeg' })
    }
    try {
      const [{ ActionSheet, ActionSheetButtonStyle }, { Camera, CameraResultType, CameraSource }] = await Promise.all([
        import('@capacitor/action-sheet'),
        import('@capacitor/camera'),
      ])
      const choice = await ActionSheet.showActions({
        title: t('Thêm ảnh', 'Add photos'),
        options: [
          { title: t('Chụp ảnh', 'Take Photo') },
          { title: t('Chọn từ thư viện', 'Choose from Library') },
          { title: t('Hủy', 'Cancel'), style: ActionSheetButtonStyle.Cancel },
        ],
      })
      if (choice.index === 0) {
        const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 90 })
        if (photo.webPath) await addPhotos([await toFile(photo.webPath, 0)])
      } else if (choice.index === 1) {
        const res = await Camera.pickImages({ quality: 90, limit: remaining })
        const files = await Promise.all(res.photos.map((p, i) => toFile(p.webPath as string, i)))
        if (files.length) await addPhotos(files)
      }
    } catch { /* cancelled / permission denied / plugin missing */ }
  }

  const addPhotos = async (files: FileList | File[] | null) => {
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

  // Optional listing clip. Validate type + size + DURATION (≤60s, read from metadata) + CODEC
  // on the client so the seller gets an instant, specific rejection; the server re-checks
  // magic bytes and the bucket re-checks type/size at upload.
  const VIDEO_MAX_MB = 50
  // HEVC (H.265) detector: iPhones capture .mov/.mp4 in High-Efficiency HEVC by default, which
  // mid-range Android Chrome (the majority buyer here) often can't decode — the clip would play
  // as a black box for most of the audience and the seller would never know. The `hvc1`/`hev1`
  // codec fourcc lives in the moov box, which sits at the START (faststart) or END of the file —
  // scan both edges. H.264 (`avc1`) passes. Heuristic by design: a false negative just means the
  // clip uploads as-is; the sniff costs two 2MB slices, no full read.
  const hasHevcTrack = async (f: File): Promise<boolean> => {
    const EDGE = 2 * 1024 * 1024
    const edges = f.size <= 2 * EDGE ? [f] : [f.slice(0, EDGE), f.slice(f.size - EDGE)]
    const dec = new TextDecoder('latin1')
    for (const part of edges) {
      const text = dec.decode(await part.arrayBuffer())
      if (text.includes('hvc1') || text.includes('hev1')) return true
    }
    return false
  }
  const addVideo = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) { toast.error(t('Chỉ nhận video MP4, WebM hoặc MOV.', 'Only MP4, WebM or MOV videos.')); return }
    if (f.size > VIDEO_MAX_MB * 1024 * 1024) { toast.error(t(`Video quá lớn (tối đa ${VIDEO_MAX_MB}MB).`, `Video is too large (${VIDEO_MAX_MB}MB max).`)); return }
    setVideoBusy(true)
    const url = URL.createObjectURL(f)
    try {
      const dur = await new Promise<number>((resolve) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => resolve(v.duration)
        v.onerror = () => resolve(NaN)
        v.src = url
      })
      // 61s tolerance for rounding; Infinity/NaN = unreadable metadata → reject (can't verify ≤60s).
      if (!Number.isFinite(dur) || dur > 61) {
        URL.revokeObjectURL(url)
        toast.error(t('Video phải dài tối đa 60 giây.', 'Video must be 60 seconds or less.'))
        return
      }
      // HEVC is no longer rejected: the server transcodes it to H.264 at publish (fixing the
      // Android-black-video problem). Record the fourcc probe so submit can fail CLOSED if that
      // transcode doesn't succeed (rather than ship a raw HEVC clip that plays black).
      const hevc = await hasHevcTrack(f).catch(() => false)
      setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return { url, file: f, hevc } })
    } finally {
      setVideoBusy(false)
    }
  }
  const removeVideo = () => setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return null })

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

      // Upload a newly-picked clip; keep an already-hosted one (edit). null clears it (removed).
      // DIRECT browser→storage: a Vercel function can't proxy the bytes (bodies over ~4.5MB are
      // rejected before the route runs; real clips are 10–50MB). Four steps: mint a signed upload
      // URL (auth + enforcement + type/size gates), PUT the file straight to Supabase, /complete
      // verifies the landed object's magic bytes, then /transcode re-encodes it to a lean H.264
      // MP4 (fixes HEVC-plays-black on Android + cuts egress) and returns the compressed URL.
      let videoUrl: string | null = null
      if (video?.file) {
        const sig = await fetch('/api/upload/video/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: video.file.type, size: video.file.size }),
        })
        if (!sig.ok) throw new Error('video')
        const { path, token } = (await sig.json()) as { path: string; token: string }
        const { error: upErr } = await createSupabaseBrowser()
          .storage.from('listing-videos')
          .uploadToSignedUrl(path, token, video.file, { contentType: video.file.type, cacheControl: '31536000' })
        if (upErr) throw new Error('video')
        const done = await fetch('/api/upload/video/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        if (!done.ok) throw new Error('video')

        // Transcode. For H.264 this falls open to the raw clip on any hiccup ({fallback}); for
        // HEVC it fails closed (422) — a raw HEVC clip plays black on most Android buyers, so
        // we surface a retry rather than publish a broken video.
        const xc = await fetch('/api/upload/video/transcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, hevc: video.hevc === true }),
        })
        if (xc.status === 422) throw new Error('video_hevc')
        videoUrl = xc.ok ? (((await xc.json()) as { url?: string }).url ?? null) : null
        if (!videoUrl) throw new Error('video')
      } else if (video && !video.url.startsWith('blob:')) {
        videoUrl = video.url
      }

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
        video: videoUrl,
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
          : msg === 'video'
          ? t('Không tải được video, vui lòng thử lại.', 'Could not upload your video — please try again.')
          : msg === 'video_hevc'
          ? t('Không xử lý được video HEVC này. Hãy xuất lại dạng MP4 (H.264): trên iPhone bật Cài đặt → Camera → Định dạng → Tương thích nhất.', "Couldn't process this HEVC video. Export it as MP4 (H.264) — on iPhone: Settings → Camera → Formats → Most Compatible.")
          : msg === 'no_phone_in_listing' || msg === 'contact_in_text'
          ? t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post.")
          : msg === 'banned_words'
          ? t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again.")
          : msg === 'urgent_quota'
          ? t('Bạn đã có 2 tin "Bán gấp" đang chạy — chờ một tin hết hạn rồi thử lại.', 'You already have 2 urgent listings running — wait for one to expire and try again.')
          : msg === 'urgent_cooldown'
          ? t('Tin này vừa hết hạn "Bán gấp" — có thể bật lại sau 7 ngày.', 'This listing just finished an urgent run — you can turn it on again after 7 days.')
          : msg === 'duplicate_listing'
          ? t('Bạn đã có tin đang hiển thị cho sản phẩm này. Vào Tin đăng để chỉnh sửa hoặc xác nhận còn hàng thay vì đăng lại.', "You already have a live listing for this item. Open My Listings to edit it or confirm it's still available instead of posting it again.")
          : msg === 'photo_required'
          ? t('Cần ít nhất một ảnh để đăng tin.', 'You need at least one photo to post.')
          : msg === 'photos_min'
          ? t('Cần ít nhất 3 ảnh từ các góc khác nhau (không phải cùng một ảnh lặp lại).', 'You need at least 3 photos from different angles (not the same photo repeated).')
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
            <Button asChild variant="cta" size="none">
              <a href={`/listings/${createdId}`} className="px-6 py-2.5">
                {t('Xem tin của bạn', 'View your listing')}
              </a>
            </Button>
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
      <p className={cn('text-base text-body', !embedded && 'mt-1')}>{t('Điền các mục bên dưới — bản xem trước cập nhật ngay.', 'Fill in the sections below — your preview updates live.')}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
        {/* ── FORM ── */}
        <div className="min-w-0 space-y-10">
          {/* Photos */}
          <Section id="pw-photo" title={t('Ảnh', 'Photos')} hint={t('Tối thiểu 3 ảnh từ các góc khác nhau, tối đa 6. Ảnh đầu là ảnh bìa. Tin nhiều ảnh được xem nhiều hơn hẳn.', 'At least 3 photos from different angles, up to 6. The first is your cover. Listings with more photos get far more views.')}>
            {/* A photo grid is not a labelable control, so it can't go in a <Field>. Same
                contract by hand: it names itself, reports invalid, and points at its error. */}
            <div
              role="group"
              aria-label={t('Ảnh', 'Photos')}
              aria-invalid={err.photo ? true : undefined}
              aria-describedby={err.photo ? 'pw-photo-error pw-photo-hint' : 'pw-photo-hint'}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addPhotos(e.dataTransfer.files) }}
              className={cn('grid grid-cols-3 gap-2 rounded-2xl transition-colors sm:grid-cols-4', dragOver && 'bg-brand/5 ring-2 ring-brand/40', err.photo && 'p-2 -m-2 ring-2 ring-destructive/60')}
            >
              {photos.map((p, i) => (
                <div
                  key={i}
                  {...bindPhoto(i)}
                  className={cn(
                    'group relative aspect-square cursor-move select-none overflow-hidden rounded-xl bg-tint transition-[transform,box-shadow]',
                    // Lifted (mid-drag) affordance: the grabbed tile rises above the grid.
                    draggingPhoto === i && 'z-10 scale-105 shadow-xl ring-2 ring-brand/50',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
                  {i === 0 ? (
                    <span className="absolute left-1.5 top-1.5 rounded-lg bg-primary px-1.5 py-0.5 text-3xs font-bold text-white">{t('Bìa', 'Cover')}</span>
                  ) : (
                    // transition-opacity is load-bearing: it must beat the base
                    // transition-all, or the tile's drag transform animates.
                    <Button
                      type="button"
                      variant="bare"
                      size="none"
                      onClick={() => movePhoto(i, 0)}
                      className="absolute bottom-1 left-1 rounded-lg bg-black/55 px-1.5 py-0.5 text-3xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                    >
                      {t('Đặt làm bìa', 'Make cover')}
                    </Button>
                  )}
                  <IconButton size="xs" variant="overlay" aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 h-6 w-6">
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
              {photos.length < 6 && (
                <label
                  // In the native app, tap → native camera/gallery action sheet instead of the web
                  // file picker (preventDefault stops the hidden input from also opening).
                  onClick={(e) => { if (isNativeApp()) { e.preventDefault(); void pickNativePhotos() } }}
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-brand hover:text-accent-foreground">
                  {converting ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                  <span className="text-3xs font-semibold">{converting ? t('Đang xử lý…', 'Processing…') : t('Thêm ảnh', 'Add')}</span>
                  <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              )}

              {/* Optional video — its own square in the SAME grid, so it's exactly a photo-tile
                  size. col-start-1 forces it onto its own row on mobile (under the photos);
                  col-start-auto lets it sit inline (beside) from sm up. */}
              <div className="col-start-1 aspect-square sm:col-start-auto">
                {video ? (
                  <div className="group relative h-full w-full overflow-hidden rounded-xl bg-black">
                    <video src={video.url} muted loop autoPlay playsInline preload="metadata" className="h-full w-full object-cover" />
                    <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-0.5 text-3xs font-bold text-white backdrop-blur-[2px]">
                      <Video className="h-3 w-3" /> {t('Video', 'Video')}
                    </span>
                    <IconButton size="xs" variant="overlay" aria-label={t('Xóa video', 'Remove video')} onClick={removeVideo} className="absolute right-1 top-1 h-6 w-6">
                      <X className="h-4 w-4" />
                    </IconButton>
                  </div>
                ) : (
                  <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-brand hover:text-accent-foreground">
                    {videoBusy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Video className="h-6 w-6" />}
                    <span className="text-3xs font-semibold">{videoBusy ? t('Đang kiểm tra…', 'Checking…') : t('Thêm video', 'Add video')}</span>
                    <span className="text-3xs leading-tight text-ink-4">{t('tùy chọn · 60 giây', 'optional · 60s')}</span>
                    <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => { addVideo(e.target.files); e.currentTarget.value = '' }} />
                  </label>
                )}
              </div>
            </div>
            {err.photo && <p id="pw-photo-error" role="alert" className="mt-1.5 text-xs font-semibold text-destructive">{t('Thêm ít nhất 3 ảnh từ các góc khác nhau', 'Add at least 3 photos from different angles')}</p>}
            {/* Media hint covers the video square in the grid above. */}
            <p id="pw-photo-hint" className="mt-1.5 text-xs text-ink-4">{t('Ảnh đầu là ảnh bìa. Video (tùy chọn) tự phát khi rê chuột và trong mục Video.', 'First photo is your cover. A video (optional) autoplays on hover and in the Video feed.')}</p>
            {aiEnabled && photos.length > 0 && (
              <Button
                type="button"
                variant="bare"
                size="none"
                onClick={autofillFromPhoto}
                disabled={!!aiBusy}
                className="mt-3 gap-1.5 rounded-xl border border-line-strong px-3 py-1.5 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer"
              >
                {aiBusy === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t('Tự điền từ ảnh', 'Autofill from photo')}
              </Button>
            )}
          </Section>

          {/* Category & type */}
          <Section id="pw-category" title={t('Danh mục', 'Category')} hint={t('Chọn đúng danh mục để người mua dễ tìm thấy.', 'Pick the right category so buyers find you.')}>
            {showRentToggle && (
              <Field group label={t('Bán hay cho thuê?', 'For sale or for rent?')}>
                {/* Single-select and mutually exclusive = a radio group, not two buttons that
                    happen to paint one of themselves blue. The RadioGroup carries its own
                    aria-label because Field's `group` wrapper labels a role="group", which cannot
                    name the radiogroup nested inside it. `switchIntent` already early-returns when
                    `to === intent`, which is exactly the radio contract (re-selecting the checked
                    option fires nothing) — so the swap is behaviour-for-behaviour identical. */}
                <RadioGroup
                  value={intent}
                  onValueChange={(v) => switchIntent(v as 'sell' | 'rent')}
                  aria-label={t('Bán hay cho thuê?', 'For sale or for rent?')}
                  className="inline-flex rounded-xl bg-tint p-1"
                >
                  {(['sell', 'rent'] as const).map((v) => (
                    <Radio
                      key={v}
                      value={v}
                      className={cn('rounded-lg px-4 py-1.5 text-sm font-bold transition-colors', intent === v ? 'bg-primary text-white' : 'text-body hover:text-foreground')}
                    >
                      {v === 'sell' ? t('Bán', 'For sale') : t('Cho thuê', 'For rent')}
                    </Radio>
                  ))}
                </RadioGroup>
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
                {/* Chip grid = a RADIO GROUP: pick exactly one category. It used to be a
                    role="group" of <Button>s whose only selected cue was `bg-primary text-white`,
                    so assistive tech was told a category grid existed but never which category was
                    chosen. Base UI now supplies role="radiogroup" + per-chip aria-checked, one tab
                    stop, and arrow keys.
                    Two things this ALSO fixes, quietly: (a) aria-invalid is not allowed on
                    role="group" but IS supported on role="radiogroup", so the error state finally
                    reports legally; (b) re-clicking the ALREADY-selected chip no longer re-runs
                    chooseCategory(), which used to wipe the user's subcategory/brand/attrs.
                    Layout is untouched — RadioGroup renders the same <div> with the same classes. */}
                {/* ⚠️ DELIBERATELY NOT A RadioGroup — do not "upgrade" this to one.
                    It was briefly made a Base UI RadioGroup for the aria-checked win, and that was a
                    DATA-LOSS BUG. Base UI radios use SELECTION-FOLLOWS-FOCUS (RadioGroup.js:190 marks
                    any Arrow key as touched; the newly-focused RadioRoot.js:151 onFocus fires
                    inputRef.click() → onValueChange). And selecting a category here is DESTRUCTIVE:
                    chooseCategory() wipes subcategory, attrs, ranges, condition, brand and model.
                    So a keyboard user who had filled the form, tabbed back to the category chips and
                    pressed ONE arrow key just to look at the options would silently lose all of it,
                    with no undo. Radio semantics assume selecting is cheap. Here it is not.
                    Toggle semantics are the honest model: aria-pressed announces the selected chip,
                    and a chip only fires when you deliberately activate it. facet-bar's segmented
                    chips are aria-pressed for the same reason. */}
                <div
                  role="group"
                  aria-label={t('Danh mục', 'Category')}
                  aria-describedby={err.category ? 'pw-category-error' : undefined}
                  className={cn('flex flex-wrap gap-2 rounded-xl transition-colors', err.category && 'p-2 -m-2 ring-2 ring-destructive/60')}
                >
                  {categories.map((c) => (
                    <Button
                      key={c.id}
                      variant="bare"
                      size="none"
                      type="button"
                      aria-pressed={categorySlug === c.slug}
                      onClick={() => chooseCategory(c.slug)}
                      className={cn('gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors', categorySlug === c.slug ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
                    >
                      <CategoryIcon name={c.icon} className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-body')} />
                      {tr(c.name, c.nameVi)}
                    </Button>
                  ))}
                </div>
                {err.category && <p id="pw-category-error" role="alert" className="text-xs font-semibold text-destructive">{t('Chọn một danh mục', 'Pick a category')}</p>}
              </>
            )}

            {categorySlug && typeOptions.length > 1 && (
              <Field group label={t('Loại tin', 'Listing type')}>
                <Chips options={LISTING_TYPES.filter((lt) => typeOptions.includes(lt.value)).map((lt) => ({ value: lt.value, label: tr(lt.label, lt.labelVi) }))} value={listingType} onPick={setListingType} />
              </Field>
            )}
            {categorySlug && subOptions.length > 0 && (
              <Field group label={t('Danh mục con', 'Subcategory')}>
                <Chips options={subOptions.map((s) => ({ value: s.slug, label: tr(s.name, s.nameVi) }))} value={subcategorySlug} onPick={(v) => setSubcategorySlug(v === subcategorySlug ? '' : v)} />
              </Field>
            )}
            {showBrand && (
              <Field label={t('Thương hiệu', 'Brand')} hint={t('Giúp người mua tìm theo hãng. Bỏ trống nếu không có.', 'Helps buyers find you by brand. Leave blank if none.')}>
                <FieldControl
                  render={
                    <Input
                      value={brand}
                      list="brand-options"
                      maxLength={40}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder={t('VD: Apple, Samsung, Honda', 'e.g. Apple, Samsung, Honda')}
                      className="max-w-md"
                    />
                  }
                />
                <datalist id="brand-options">
                  {brandOptions.map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
            )}
            {showBrand && brand.trim() && (
              <Field label={t('Mẫu / Model', 'Model')} hint={t('VD: iPhone 14 Pro, Sorento. Giúp người mua lọc theo mẫu.', 'e.g. iPhone 14 Pro, Sorento. Lets buyers filter by model.')}>
                <FieldControl
                  render={
                    <Input
                      value={model}
                      maxLength={60}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={t('VD: iPhone 14 Pro', 'e.g. iPhone 14 Pro')}
                      className="max-w-md"
                    />
                  }
                />
              </Field>
            )}
          </Section>

          {/* Details */}
          <Section title={t('Chi tiết', 'Details')}>
            <Field label={t('Tiêu đề', 'Title')} counter={`${title.length}/${TITLE_MAX}`} error={titleErr}>
              {/* `id` goes on the CONTROL, not the wrapper: scrollToMissing() does
                  getElementById('pw-title').focus() and that focus() is guarded by
                  `instanceof HTMLInputElement` — on a wrapper <div> it silently no-ops.
                  Passing it to FieldControl also makes it the id the label points at. */}
              <FieldControl
                id="pw-title"
                render={
                  <Input
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => touch('title')}
                    placeholder={t('VD: iPhone 14 128GB — pin 92%', 'e.g. iPhone 14 128GB — battery 92%')}
                    className={cn('max-w-2xl', err.title && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
            {/* `pw-description` stays on the WRAPPER — it is the scroll anchor, and other
                code may look it up. Only the title's id lives on its control. */}
            <Field id="pw-description" label={t('Mô tả', 'Description')} counter={`${description.length}/${DESC_MAX}`} hint={t('Tình trạng, lý do bán, điểm nổi bật. Đừng ghi số điện thoại.', 'Condition, why you’re selling, what stands out. No phone numbers.')} error={descErr}>
              {/* No mb-* on the row below: the Field wrapper is now `flex flex-col gap-1.5`, and a
                  flex GAP does not collapse with a sibling's margin the way the old `space-y-1.5`
                  block flow did — they ADD. An mb-1.5 here would put 12px under the row, not 6px. */}
              {aiEnabled && (
                <div className="flex max-w-2xl justify-end">
                  <Button
                    type="button"
                    variant="bare"
                    size="none"
                    onClick={polishDescription}
                    disabled={!!aiBusy || description.trim().length < 3}
                    title={t('Viết lại chuyên nghiệp bằng AI', 'Rewrite professionally with AI')}
                    // disabled:pointer-events-auto undoes the base's baked
                    // disabled:pointer-events-none — this button is disabled until the
                    // description has 3 chars, and that is exactly when its title=
                    // tooltip explains why. A disabled <button> still fires no click.
                    className="gap-1 rounded-lg px-2 py-1 text-2xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:pointer-events-auto disabled:opacity-40 cursor-pointer"
                  >
                    {aiBusy === 'desc' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {t('Chỉnh bằng AI', 'Polish with AI')}
                  </Button>
                </div>
              )}
              <FieldControl
                render={
                  <Textarea
                    value={description}
                    maxLength={DESC_MAX}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => touch('description')}
                    rows={5}
                    placeholder={t('Mô tả chi tiết…', 'Describe it in detail…')}
                    className={cn('max-w-2xl resize-none', err.description && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
          </Section>

          {/* Specifics (condition + attributes) */}
          {categorySlug && (hasCondition || attrFacets.length > 0) && (
            <Section title={t('Thông số', 'Specifics')}>
              {hasCondition && (
                <Field group id="pw-condition" label={t('Tình trạng', 'Condition')}>
                  <Chips options={[{ value: 'new', label: t('Mới', 'New') }, { value: 'used', label: t('Đã dùng', 'Used') }]} value={condition} onPick={setCondition} />
                </Field>
              )}
              {attrFacets.map((f, fi) => (
                <Field group key={f.key} id={fi === 0 ? 'pw-details' : undefined} label={tr(f.label, f.labelVi)}>
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
                {/* VndInput renders a <div> (input + VND suffix + preset chips), so it is not a
                    labelable control and cannot go inside a <FieldControl>. The Section's heading
                    "Giá/Price" is a heading, not a label — so the name and the reason have to be
                    handed to the inner <input> by hand, or a screen reader reads this as an
                    "invalid, blank edit field" with no name and no reason, on the one control that
                    blocks every publish. */}
                <div className="flex-1">
                  <VndInput
                    id="pw-price-input"
                    value={price}
                    onChange={setPrice}
                    placeholder={t('Nhập giá', 'Enter price')}
                    invalid={err.price}
                    aria-label={t('Giá', 'Price')}
                    aria-describedby={priceErr ? 'pw-price-error' : undefined}
                  />
                </div>
                {priceUnit && <span className="shrink-0 text-sm font-semibold text-ink-4">{priceUnit}</span>}
              </div>
              {priceErr && <p id="pw-price-error" role="alert" className="mt-1.5 text-xs font-semibold text-destructive">{priceErr}</p>}
              {priceBand && Number(price) > 0 && <PriceGuidance price={Number(price)} band={priceBand} />}
              {/* Negotiable vs fixed — a fixed price hides the offer UI so buyers just
                  ask availability and buy directly (seller's convenience). Fixed price
                  also switches off Urgent: urgency promises flexibility. */}
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('Kiểu giá', 'Price type')}>
                {[
                  { val: true, label: t('Có thể trả giá', 'Negotiable'), hint: t('Người mua có thể trả giá', 'Buyers can send offers') },
                  { val: false, label: t('Giá cố định', 'Fixed price'), hint: t('Không nhận trả giá', 'No offers — ask & buy directly') },
                ].map((opt) => (
                  <Button
                    key={String(opt.val)}
                    type="button"
                    variant="bare"
                    size="none"
                    onClick={() => { setNegotiable(opt.val); if (!opt.val) setUrgent(false) }}
                    aria-pressed={negotiable === opt.val}
                    className={cn(
                      // Stacked two-line label: `block` (the base is inline-flex) and
                      // `whitespace-normal` (the base nowrap inherits into the hint line).
                      'block whitespace-normal rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
                      negotiable === opt.val ? 'bg-primary text-white' : 'bg-tint text-body hover:bg-muted',
                    )}
                  >
                    {opt.label}
                    <span className={cn('block text-xs font-medium', negotiable === opt.val ? 'text-white/80' : 'text-ink-4')}>{opt.hint}</span>
                  </Button>
                ))}
              </div>
              {/* Urgent sale ("Bán gấp") — free, 7 days, auto-expires. Selecting it
                  force-enables offers (the server enforces the same coupling). Uses the
                  destructive token (not warning): white-on-warning is unreadable in dark
                  (--warning is amber-400 there). Distinct from the blue selections. */}
              <div className="mt-3">
                <Button
                  type="button"
                  variant="bare"
                  size="none"
                  onClick={() => { const next = !urgent; setUrgent(next); if (next) setNegotiable(true) }}
                  aria-pressed={urgent}
                  className={cn(
                    // Block-level flex row, left-aligned, wrapping: `flex` (base is
                    // inline-flex), `justify-start` (base centres), and
                    // `whitespace-normal` (base nowrap inherits into the two-line hint).
                    'flex justify-start whitespace-normal gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
                    // Urgent is NOT an error: it wears the same solid-ink tone the urgent
                    // chip uses on cards (card-badges TONE.urgent), not the destructive red.
                    // Red here would both conflate urgency with failure and fail AA in dark
                    // (white on the light dark-mode red is 3.17:1).
                    urgent ? 'bg-foreground text-background' : 'bg-tint text-body hover:bg-muted',
                  )}
                >
                  <Zap className={cn('h-4 w-4 shrink-0', urgent && 'fill-current')} />
                  <span>
                    {t('Bán gấp', 'Urgent sale')}
                    <span className={cn('block text-xs font-medium', urgent ? 'text-white/80' : 'text-ink-4')}>
                      {t('Nổi bật 7 ngày — cần bán nhanh, sẵn sàng nhận trả giá', 'Highlighted for 7 days — sell fast, open to offers')}
                    </span>
                  </span>
                </Button>
              </div>
            </div>
          </Section>

          {/* Location */}
          <Section id="pw-location" title={t('Khu vực', 'Location')}>
            {/* A popover trigger + a geolocate button — no labelable control, so this is
                Field's contract by hand. The trigger carries it too: it is the focusable
                one, so it is what a screen reader actually lands on. */}
            <div
              role="group"
              aria-label={t('Khu vực', 'Location')}
              aria-invalid={err.location ? true : undefined}
              aria-describedby={err.location ? 'pw-location-error' : undefined}
              className="flex max-w-md items-center gap-2"
            >
              <Button
                variant="bare"
                size="none"
                type="button"
                ref={areaBtnRef}
                aria-invalid={err.location ? true : undefined}
                aria-describedby={err.location ? 'pw-location-error' : undefined}
                onClick={() => setAreaOpen((o) => !o)}
                className={cn(
                  // POPOVER ANCHOR. AreaFilter's reposition() reads this button's
                  // getBoundingClientRect() during the render that opens the panel, so three
                  // base classes have to be cancelled here or the panel lands wrong / the
                  // control changes weight:
                  //   active:scale-100 — the base active:scale-[0.97] shrinks the rect mid-press,
                  //     and the open-render happens while the button is still :active. Same
                  //     load-bearing guard as price-range-filter's trigger.
                  //   font-normal — the placeholder span below has NO weight of its own, so the
                  //     base font-medium would inherit into it and bold it 400→500. (The
                  //     picked-area span carries its own font-medium and is unaffected.)
                  //   shrink — flex-1 and shrink-0 are different tailwind-merge groups, so the
                  //     base's shrink-0 survives twMerge and beats flex-1's flex-shrink:1 on
                  //     stylesheet order. `shrink` is the same group, so it wins and restores it.
                  // duration-150 restores the default transition time the base's duration-100 cuts.
                  'flex min-w-0 flex-1 shrink items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-sm font-normal text-left transition-colors duration-150 active:scale-100 hover:bg-muted',
                  err.location && 'ring-2 ring-destructive/60',
                )}
              >
                <span className={cn('flex min-w-0 items-center gap-2', areaLabel ? 'text-foreground font-medium' : 'text-ink-4')}>
                  <MapPin className="h-4 w-4 shrink-0 text-accent-foreground" />
                  <span className="truncate">{areaLabel || t('Chọn khu vực', 'Set area')}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" />
              </Button>
              {/* Quick "use my current location" */}
              <IconButton
                size="lg"
                onClick={useMyLocation}
                disabled={locating}
                aria-label={t('Dùng vị trí hiện tại', 'Use my current location')}
                title={t('Dùng vị trí hiện tại', 'Use my current location')}
                className="h-[46px] w-[46px] rounded-xl bg-tint text-accent-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-60"
              >
                {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
              </IconButton>
            </div>
            {err.location && <p id="pw-location-error" role="alert" className="mt-1.5 text-xs font-semibold text-destructive">{t('Chọn khu vực', 'Set the area')}</p>}
          </Section>

          {/* Contact — taken from your ACCOUNT (a number belongs to one account, so
              it isn't re-typed per post). Missing name/phone → add it in Settings. */}
          <Section id="pw-contact" title={t('Liên hệ', 'Contact')} hint={t('Số của bạn được giữ kín — người mua nhắn tin trong ứng dụng, chỉ hiện số sau khi bạn trả lời.', 'Your number stays private — buyers message you in-app; it’s revealed only after you reply.')}>
            {!meLoaded ? (
              <div className="h-5 w-56 rounded-lg shimmer" />
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
                  <Field label={t('Tên của bạn', 'Your name')} error={err.contactName ? t('Thêm tên của bạn', 'Add your name') : undefined}>
                    <FieldControl
                      render={
                        <Input
                          value={contactName}
                          maxLength={80}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder={t('Tên hiển thị cho người mua', 'Name buyers will see')}
                          className={cn('max-w-md', err.contactName && 'ring-2 ring-destructive/60')}
                        />
                      }
                    />
                  </Field>
                )}

                {/* Phone — quick-edit inline (no trip to Settings). Shows the saved number
                    with a "Change" toggle; an input when it's missing or being edited. */}
                {!editingPhone && phoneOk ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{contactPhone}</span>
                    <Button variant="bare" size="none" type="button" onClick={() => setEditingPhone(true)} className="text-xs font-bold text-accent-foreground hover:underline">
                      {t('Đổi số', 'Change number')}
                    </Button>
                  </div>
                ) : (
                  <Field label={t('Số điện thoại', 'Phone number')} hint={t('Người mua không thấy số cho đến khi bạn trả lời.', 'Buyers never see it until you reply.')} error={err.contactPhone ? t('Thêm số điện thoại hợp lệ', 'Add a valid phone number') : undefined}>
                    <FieldControl
                      render={
                        <Input
                          type="tel"
                          inputMode="tel"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="+84…"
                          className={cn('max-w-md', err.contactPhone && 'ring-2 ring-destructive/60')}
                        />
                      }
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

          {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        </div>

        {/* ── PREVIEW + PUBLISH (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="space-y-2">
              <span className="text-2xs font-bold uppercase tracking-wider text-ink-4">{t('Xem trước', 'Live preview')}</span>
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
            <p className="flex items-start gap-1.5 pt-1 text-2xs leading-relaxed text-ink-4">
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
            <p className="truncate text-2xs font-semibold text-ink-4">
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

// Quiet price-guidance box under the price input — where this ask sits vs the market
// band (P25–P75 of comparable listings, same data as the PDP's "Market price" module).
// Amber only when priced ABOVE the band (a nudge, never a blocker); a low ask is the
// seller's call, so it stays neutral. Renders only when a reliable band exists.
function PriceGuidance({ price, band }: { price: number; band: { n: number; p25: number; p75: number } }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  // compactPrice matches the PDP MarketPrice module — same data, same voice
  // (and full VND pairs overflow the sentence on 320px screens).
  const range = `${compactPrice(band.p25, loc)} – ${compactPrice(band.p75, loc)}`
  const pos = price < band.p25 ? 'low' : price > band.p75 ? 'high' : 'typical'
  return (
    <div
      className={cn(
        'mt-2 flex max-w-md items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium leading-relaxed',
        pos === 'high' ? 'bg-warning/10 text-warning' : 'bg-tint text-body',
      )}
    >
      {pos === 'typical' && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
      <span>
        {pos === 'high'
          ? tr(`Above the typical ${range} range — fairly-priced listings sell faster`, `Cao hơn mặt bằng ${range} — tin có giá hợp lý thường bán nhanh hơn`)
          : pos === 'low'
            ? tr(`Below the typical ${range} range — buyers will see a good deal`, `Thấp hơn mặt bằng ${range} — người mua sẽ thấy đây là mức giá tốt`)
            : tr(`Similar listings go for ${range} — yours is in range`, `Tin tương tự có giá ${range} — giá của bạn hợp lý`)}
      </span>
    </div>
  )
}

